"""Year-end odometer audit from driver-card files.

The fleet has no vehicle-unit downloads, but every driver card records, per
insertion, the vehicle's registration and its odometer at insertion and at
withdrawal (EF_Vehicles_Used). Pooling those records from all driver cards
gives, for each vehicle, an odometer timeline dense enough to read off the
km-stand on 31.12 of each year, or the nearest reading before/after.

Two tables:
    card_scan_files     one row per scanned card file (path, size, driver, errors)
    card_vehicle_usage  one row per (source, card, vehicle, insertion window);
                        the same window appears in every later download of
                        that card, so it is de-duplicated by the UNIQUE key.

Sources are kept apart on purpose: the user audits EITHER the drivers'
current files ("drivers") OR folders picked in MEGA ("mega") OR the upload
archive ("archive"), and a report never mixes them.

The scan walks two storage areas in a background thread: the drivers'
folders ({SYNC_DEST_FOLDER}/{driver}/*.ddd, source "drivers") and a separate
audit archive ({ODOMETER_AUDIT_FOLDER}/**, source "archive") where old card
files are bulk-uploaded without being mixed into the driver folders. Files
already scanned with the same size are skipped, so re-runs only pick up new
downloads. Uploads (single files, folders, or ZIPs) are parsed right away
and, by default, kept in the audit archive.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import zipfile
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from auth.helpers import _load_config, _save_config
from core.card_vehicles import parse_card_vehicles
from database import get_db
from services import storage_service
from services.drivers_index import build_drivers_data, get_storage_client, load_portal_cache, save_portal_cache

logger = logging.getLogger(__name__)
CET = ZoneInfo('Europe/Berlin')

_PLATE_STRIP = re.compile(r'[^A-Z0-9]')


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def normalize_plate(plate: str) -> str:
    """'TF LS 2262', 'TF LS2262', 'tf-ls\\xa02262' -> 'TFLS2262'."""
    return _PLATE_STRIP.sub('', (plate or '').upper().replace('\u00a0', ' '))


def _sync_folder() -> str:
    return os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD').rstrip('/')


def audit_folder() -> str:
    """Storage folder for the bulk-uploaded audit archive (kept apart from drivers)."""
    return os.environ.get('ODOMETER_AUDIT_FOLDER', '/Archiv-Fahrerkarten').rstrip('/')


_SAFE_NAME = re.compile(r'[^A-Za-z0-9._()\- ]+')

# Driver-card download files come with several extensions depending on the
# download tool: .ddd (most), .c1b (VDO downloadkey), .esm (Stoneridge),
# .tgd (Tachogramm), .dat. The content is the same TLV card file.
CARD_EXTS = ('.ddd', '.c1b', '.esm', '.tgd', '.dat')


def is_card_file(name: str) -> bool:
    return (name or '').lower().endswith(CARD_EXTS)


# In a folder the user picked by hand, anything that is not plainly a
# document is tried; the parser tells a card file from the rest.
_NOT_CARD_EXTS = ('.xlsx', '.xls', '.csv', '.pdf', '.txt', '.doc', '.docx', '.zip', '.7z', '.rar',
                  '.jpg', '.jpeg', '.png', '.gif', '.json', '.xml', '.html', '.htm', '.ini', '.log', '.db')


def maybe_card_file(name: str) -> bool:
    n = (name or '').lower()
    return bool(n) and not n.endswith(_NOT_CARD_EXTS)
_FOLDERS_KEY = 'odometer_audit_folders'

SOURCES = ('drivers', 'mega', 'archive')


def source_group(detail: str) -> str:
    """card_scan_files.source (detailed) -> one of SOURCES."""
    if detail.startswith('mega:'):
        return 'mega'
    if detail in ('archive', 'upload'):
        return 'archive'
    return 'drivers'

def ensure_schema() -> None:
    """Called before init_db(): the audit tables are a cache of parsed files,
    so when their layout changed (v1 had no `source` column) they are dropped
    and recreated by init_db(); a rescan rebuilds everything."""
    try:
        from database import get_engine
        with get_db() as db:
            if get_engine() == 'postgresql':
                cols = [r['column_name'] for r in db.query(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'card_vehicle_usage'")]
            else:
                cols = [r['name'] for r in db.query('PRAGMA table_info(card_vehicle_usage)')]
            if cols and 'source' not in cols:
                db.execute('DROP TABLE IF EXISTS card_vehicle_usage')
                db.execute('DROP TABLE IF EXISTS card_scan_files')
                db.commit()
                logger.warning('odometer audit: old tables dropped (new layout); run the scan again')
    except Exception:
        logger.exception('odometer audit: schema check failed')


def _clean_folder(path: str) -> str:
    path = '/' + (path or '').replace('\\', '/').strip().strip('/')
    if '..' in path.split('/'):
        return ''
    return '' if path == '/' else path


def get_extra_folders() -> list[str]:
    """Folders already in MEGA that the user picked as extra scan sources."""
    raw = _load_config().get(_FOLDERS_KEY) or []
    out = []
    for f in raw if isinstance(raw, list) else []:
        c = _clean_folder(str(f))
        if c and c not in out:
            out.append(c)
    return out


def set_extra_folders(folders: list[str]) -> list[str]:
    out = []
    for f in folders or []:
        c = _clean_folder(str(f))
        if c and c not in out:
            out.append(c)
    _save_config({_FOLDERS_KEY: out})
    return out


def browse_storage(path: str) -> dict:
    """One level of the storage tree for the folder picker, with the number of
    .ddd files directly in each entry's level left to the client."""
    if not storage_service.is_configured():
        raise RuntimeError('Storage nie skonfigurowany (brak MEGA_S4_* w env)')
    path = _clean_folder(path) or '/'
    listing = storage_service.list_folder(path)
    ddd = [f for f in listing['files'] if is_card_file(f['name'])]
    return {
        'path': listing['path'],
        'folders': listing['folders'],
        'ddd_files': len(ddd),
        'other_files': len(listing['files']) - len(ddd),
        'sample': [f['name'] for f in (ddd or listing['files'])[:5]],
    }


def _safe_name(name: str) -> str:
    name = (name or 'upload.ddd').replace('\\', '/').rsplit('/', 1)[-1]
    name = _SAFE_NAME.sub('_', name).strip(' .') or 'upload.ddd'
    return name[:120]


# ---------------------------------------------------------------------------
# Ingest one file
# ---------------------------------------------------------------------------

def ingest_file(path: str, data: bytes, *, source: str = 'storage', driver: str = '', size: int | None = None) -> dict:
    """Parse one card file and store its vehicle records. Returns a summary."""
    size = len(data) if size is None else size
    error = ''
    parsed = {'card_number': '', 'holder': '', 'records': []}
    try:
        parsed = parse_card_vehicles(data)
        if not parsed['records'] and not parsed['card_number']:
            error = 'no vehicle records (not a driver card?)'
    except Exception as exc:  # defensive: one bad file must not stop the scan
        error = f'parse error: {exc}'
    card = parsed.get('card_number') or ''
    holder = parsed.get('holder') or ''
    driver = driver or holder
    records = parsed.get('records') or []
    now = _now_iso()
    group = source_group(source)

    with get_db() as db:
        row = db.query_one('SELECT id FROM card_scan_files WHERE path = ?', (path,))
        if row:
            file_id = int(row['id'])
            db.execute(
                'UPDATE card_scan_files SET size = ?, source = ?, driver = ?, card_number = ?, holder = ?, '
                'records = ?, error = ?, scanned_at = ? WHERE id = ?',
                (size, source, driver, card, holder, len(records), error, now, file_id),
            )
        else:
            db.execute(
                'INSERT INTO card_scan_files (path, size, source, driver, card_number, holder, records, error, scanned_at) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (path, size, source, driver, card, holder, len(records), error, now),
            )
            row = db.query_one('SELECT id FROM card_scan_files WHERE path = ?', (path,))
            file_id = int(row['id'])

        inserted = 0
        if records:
            existing = {
                (r['plate_norm'], r['first_use'], r['last_use'])
                for r in db.query('SELECT plate_norm, first_use, last_use FROM card_vehicle_usage WHERE source = ? AND card_number = ?', (group, card))
            }
            for rec in records:
                pn = normalize_plate(rec['plate'])
                if not pn:
                    continue
                key = (pn, rec['first_use'], rec['last_use'])
                if key in existing:
                    continue
                existing.add(key)
                db.execute(
                    'INSERT INTO card_vehicle_usage (source, card_number, driver, plate_norm, plate, nation, vin, odo_begin, odo_end, '
                    'first_use, last_use, file_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (group, card, driver, pn, rec['plate'], rec['nation'], rec['vin'], rec['odo_begin'], rec['odo_end'],
                     rec['first_use'], rec['last_use'], file_id),
                )
                inserted += 1
        db.commit()
    return {'path': path, 'card_number': card, 'holder': holder, 'records': len(records), 'new': inserted, 'error': error}


def _already_scanned(path: str, size: int) -> bool:
    with get_db() as db:
        row = db.query_one('SELECT size, error FROM card_scan_files WHERE path = ?', (path,))
    return bool(row) and int(row['size']) == size and not row['error']


def ingest_upload(name: str, data: bytes, *, keep: bool = True) -> list[dict]:
    """Parse an uploaded .ddd (or a .zip of them). With ``keep`` the raw file
    is also stored in the audit archive folder, under the card number, so a
    later scan or re-parse can find it. Files already in the database with
    the same name and size are skipped. Returns one result per card file."""
    name = _safe_name(name)
    if name.lower().endswith('.zip'):
        results = []
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for info in zf.infolist():
                    if info.is_dir() or not is_card_file(info.filename):
                        continue
                    if info.file_size > 4 * 1024 * 1024:
                        results.append({'path': info.filename, 'status': 'error', 'error': 'file too large', 'records': 0, 'new': 0})
                        continue
                    results.extend(ingest_upload(info.filename, zf.read(info), keep=keep))
        except zipfile.BadZipFile:
            results.append({'path': name, 'status': 'error', 'error': 'bad zip', 'records': 0, 'new': 0})
        return results

    if not is_card_file(name):
        return [{'path': name, 'status': 'error', 'error': f"not a card file ({', '.join(CARD_EXTS)})", 'records': 0, 'new': 0}]
    if not data:
        return [{'path': name, 'status': 'error', 'error': 'empty file', 'records': 0, 'new': 0}]

    # Identify the card first so the stored copy lands in its folder.
    try:
        parsed = parse_card_vehicles(data)
        card = parsed.get('card_number') or ''
    except Exception:
        card = ''
    folder = audit_folder()
    stored = keep and storage_service.is_configured()
    path = f"{folder}/{card or 'unbekannt'}/{name}" if stored else f'upload/{name}'
    if _already_scanned(path, len(data)):
        return [{'path': path, 'status': 'skipped', 'error': '', 'records': 0, 'new': 0, 'card_number': card}]
    if stored:
        try:
            storage_service.upload_bytes(path, data, content_type='application/octet-stream')
        except Exception as exc:
            return [{'path': path, 'status': 'error', 'error': f'storage: {exc}', 'records': 0, 'new': 0, 'card_number': card}]
    res = ingest_file(path, data, source='archive' if stored else 'upload')
    res['status'] = 'error' if res.get('error') else 'new'
    return [res]


# ---------------------------------------------------------------------------
# Background scan of the storage archive
# ---------------------------------------------------------------------------

class ScanState:
    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.started_at = ''
        self.finished_at = ''
        self.total = 0
        self.done = 0
        self.skipped = 0
        self.new_records = 0
        self.errors: list[dict] = []
        self.current = ''
        self.message = ''
        self.cancel = False
        self.source = ''

    def snapshot(self) -> dict:
        with self.lock:
            return {
                'running': self.running, 'started_at': self.started_at, 'finished_at': self.finished_at,
                'total': self.total, 'done': self.done, 'skipped': self.skipped, 'new_records': self.new_records,
                'errors': self.errors[-50:], 'error_count': len(self.errors), 'current': self.current,
                'message': self.message, 'source': self.source,
            }


_scan = ScanState()


def scan_status() -> dict:
    return _scan.snapshot()


def cancel_scan() -> None:
    with _scan.lock:
        _scan.cancel = True


def _list_storage_files(refresh: bool, source: str) -> list[dict]:
    """Files of ONE source: 'drivers' (current driver folders), 'mega'
    (folders the user picked) or 'archive' (the upload folder)."""
    files: list[dict] = []
    if source == 'drivers':
        drivers = None if refresh else load_portal_cache()
        if drivers is None:
            dbx = get_storage_client()
            if dbx:
                drivers = build_drivers_data(dbx, _sync_folder())
                save_portal_cache(drivers)
            else:
                drivers = load_portal_cache()  # last listing, better than nothing
                if drivers is None:
                    raise RuntimeError('Storage nie skonfigurowany (brak MEGA_S4_* w env)')
        for d in drivers:
            for f in d.get('files') or []:
                if is_card_file(f.get('name') or ''):
                    files.append({'path': f['path'], 'size': int(f.get('size') or 0), 'driver': d.get('name', ''), 'source': 'drivers'})
        return files
    if not storage_service.is_configured():
        raise RuntimeError('Storage nie skonfigurowany (brak MEGA_S4_* w env)')
    if source == 'mega':
        folders = get_extra_folders()
        if not folders:
            raise RuntimeError('Nie wybrano folderów w MEGA / Keine MEGA-Ordner gewählt')
        sources = [(f, f'mega:{f}', maybe_card_file) for f in folders]
    else:
        sources = [(audit_folder(), 'archive', is_card_file)]
    seen: set = set()
    for folder, detail, accept in sources:
        try:
            for obj in storage_service.list_prefix(folder):
                if accept(obj.get('name') or '') and obj['path_display'] not in seen:
                    seen.add(obj['path_display'])
                    files.append({'path': obj['path_display'], 'size': int(obj.get('size') or 0), 'driver': '', 'source': detail})
        except Exception as exc:
            logger.warning('odometer audit: cannot list %s: %s', folder, exc)
    return files


def start_scan(*, source: str = 'drivers', force: bool = False, refresh_list: bool = True) -> bool:
    """Start the background scan of one source; False when one is already running."""
    if source not in SOURCES:
        raise ValueError('unknown source')
    with _scan.lock:
        if _scan.running:
            return False
        _scan.running = True
        _scan.source = source
        _scan.cancel = False
        _scan.started_at = _now_iso()
        _scan.finished_at = ''
        _scan.total = _scan.done = _scan.skipped = _scan.new_records = 0
        _scan.errors = []
        _scan.current = ''
        _scan.message = 'listing files'
    threading.Thread(target=_run_scan, args=(source, force, refresh_list), name='odometer-audit-scan', daemon=True).start()
    return True


def _run_scan(source: str, force: bool, refresh_list: bool) -> None:
    try:
        files = _list_storage_files(refresh_list, source)
        if not force:
            with get_db() as db:
                done = {r['path']: int(r['size']) for r in db.query('SELECT path, size FROM card_scan_files WHERE error = ?', ('',))}
            todo = [f for f in files if done.get(f['path']) != f['size']]
        else:
            todo = files
        with _scan.lock:
            _scan.total = len(todo)
            _scan.skipped = len(files) - len(todo)
            _scan.message = 'downloading'

        def fetch(f):
            try:
                return f, storage_service.download_bytes(f['path']), None
            except Exception as exc:
                return f, None, str(exc)

        with ThreadPoolExecutor(max_workers=4) as pool:
            for f, data, err in pool.map(fetch, todo):
                if _scan.cancel:
                    break
                with _scan.lock:
                    _scan.current = f['path']
                if err:
                    with _scan.lock:
                        _scan.errors.append({'path': f['path'], 'error': err})
                        _scan.done += 1
                    continue
                try:
                    res = ingest_file(f['path'], data, source=f.get('source', 'drivers'), driver=f['driver'], size=f['size'])
                except Exception as exc:
                    logger.exception('odometer audit: ingest failed for %s', f['path'])
                    res = {'error': str(exc), 'new': 0}
                with _scan.lock:
                    _scan.done += 1
                    _scan.new_records += int(res.get('new') or 0)
                    if res.get('error'):
                        _scan.errors.append({'path': f['path'], 'error': res['error']})
        with _scan.lock:
            _scan.message = 'cancelled' if _scan.cancel else 'done'
    except Exception as exc:
        logger.exception('odometer audit scan failed')
        with _scan.lock:
            _scan.message = f'failed: {exc}'
    finally:
        with _scan.lock:
            _scan.running = False
            _scan.current = ''
            _scan.finished_at = _now_iso()


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

def summary() -> dict:
    with get_db() as db:
        files = db.query_one('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN error <> ? THEN 1 ELSE 0 END), 0) AS bad, '
                             'MAX(scanned_at) AS last FROM card_scan_files', ('',))
        usage = db.query_one('SELECT COUNT(*) AS n, COUNT(DISTINCT plate_norm) AS plates, COUNT(DISTINCT card_number) AS cards, '
                             'MIN(first_use) AS lo, MAX(last_use) AS hi FROM card_vehicle_usage')
        per_source = db.query('SELECT source, COUNT(*) AS n, COUNT(DISTINCT plate_norm) AS plates, COUNT(DISTINCT card_number) AS cards, '
                              'MIN(first_use) AS lo, MAX(last_use) AS hi FROM card_vehicle_usage GROUP BY source')
        recent_errors = db.query('SELECT path, error, scanned_at FROM card_scan_files WHERE error <> ? ORDER BY scanned_at DESC LIMIT 20', ('',))
        by_source = db.query('SELECT source, COUNT(*) AS n FROM card_scan_files GROUP BY source')
    lo, hi = (usage['lo'] or ''), (usage['hi'] or '')
    years = list(range(int(lo[:4]), int(hi[:4]) + 1)) if lo and hi else []
    return {
        'files': int(files['n'] or 0), 'files_with_errors': int(files['bad'] or 0), 'last_scan': files['last'] or '',
        'records': int(usage['n'] or 0), 'plates': int(usage['plates'] or 0), 'cards': int(usage['cards'] or 0),
        'first_record': lo, 'last_record': hi, 'years': years,
        'errors': [dict(r) for r in recent_errors],
        'sources': {('drivers' if r['source'] == 'storage' else r['source']): int(r['n']) for r in by_source},
        'by_source': {
            r['source']: {
                'records': int(r['n'] or 0), 'plates': int(r['plates'] or 0), 'cards': int(r['cards'] or 0),
                'first_record': r['lo'] or '', 'last_record': r['hi'] or '',
                'files': sum(int(x['n']) for x in by_source if source_group('drivers' if x['source'] == 'storage' else x['source']) == r['source']),
            } for r in per_source
        },
        'audit_folder': audit_folder(),
        'extra_folders': get_extra_folders(),
        'storage_configured': storage_service.is_configured(),
        'scan': scan_status(),
    }


def _cutoff(year: int) -> str:
    """Last second of 31.12 local time, as the UTC string the records use."""
    local = datetime(year, 12, 31, 23, 59, 59, tzinfo=CET)
    return local.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _year_end_reading(db, year: int, lower_bound: str, source: str) -> dict[str, dict]:
    """plate_norm -> newest record ending at or before the cutoff (odometer at withdrawal)."""
    cutoff = _cutoff(year)
    rows = db.query(
        'SELECT u.* FROM card_vehicle_usage u JOIN ('
        '  SELECT plate_norm, MAX(last_use) AS lu FROM card_vehicle_usage '
        '  WHERE source = ? AND last_use <= ? AND last_use >= ? GROUP BY plate_norm'
        ') m ON m.plate_norm = u.plate_norm AND m.lu = u.last_use WHERE u.source = ? ORDER BY u.odo_end DESC',
        (source, cutoff, lower_bound, source),
    )
    out: dict[str, dict] = {}
    for r in rows:
        out.setdefault(r['plate_norm'], dict(r))
    return out


def _next_reading(db, year: int, upper_bound: str, source: str) -> dict[str, dict]:
    """plate_norm -> oldest record starting after the cutoff (odometer at insertion)."""
    cutoff = _cutoff(year)
    rows = db.query(
        'SELECT u.* FROM card_vehicle_usage u JOIN ('
        '  SELECT plate_norm, MIN(first_use) AS fu FROM card_vehicle_usage '
        '  WHERE source = ? AND first_use > ? AND first_use <= ? GROUP BY plate_norm'
        ') m ON m.plate_norm = u.plate_norm AND m.fu = u.first_use WHERE u.source = ? ORDER BY u.odo_begin ASC',
        (source, cutoff, upper_bound, source),
    )
    out: dict[str, dict] = {}
    for r in rows:
        out.setdefault(r['plate_norm'], dict(r))
    return out


def _days_between(a: str, b: str) -> float | None:
    try:
        da = datetime.strptime(a, '%Y-%m-%dT%H:%M:%SZ')
        dbb = datetime.strptime(b, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        return None
    return round(abs((dbb - da).total_seconds()) / 86400, 1)


def year_report(year: int, source: str = 'drivers') -> dict:
    """Per vehicle: odometer on 31.12 of `year` (or nearest), with context.
    Only records of ONE source are used."""
    if source not in SOURCES:
        raise ValueError('unknown source')
    cutoff = _cutoff(year)
    lower = f'{year - 1}-01-01T00:00:00Z'       # vehicles not seen for over a year are left out
    upper = f'{year + 1}-12-31T23:59:59Z'
    with get_db() as db:
        before = _year_end_reading(db, year, lower, source)
        after = _next_reading(db, year, upper, source)
        prev = _year_end_reading(db, year - 1, f'{year - 2}-01-01T00:00:00Z', source)
        # Display form of each plate: the spelling seen most often.
        spell_rows = db.query('SELECT plate_norm, plate, COUNT(*) AS n FROM card_vehicle_usage WHERE source = ? GROUP BY plate_norm, plate', (source,))
        # Activity within the year.
        act_rows = db.query(
            'SELECT plate_norm, COUNT(*) AS n, COUNT(DISTINCT card_number) AS drivers, MIN(first_use) AS lo, MAX(last_use) AS hi, '
            'MIN(odo_begin) AS odo_lo, MAX(odo_end) AS odo_hi FROM card_vehicle_usage '
            'WHERE source = ? AND last_use >= ? AND first_use <= ? GROUP BY plate_norm',
            (source, f'{year}-01-01T00:00:00Z', cutoff),
        )
    spelling: dict[str, tuple[int, str]] = {}
    for r in spell_rows:
        if int(r['n']) > spelling.get(r['plate_norm'], (0, ''))[0]:
            spelling[r['plate_norm']] = (int(r['n']), r['plate'])
    activity = {r['plate_norm']: dict(r) for r in act_rows}

    plates = set(before) | set(after) | set(activity)
    rows = []
    for pn in plates:
        b = before.get(pn)
        a = after.get(pn)
        p = prev.get(pn)
        act = activity.get(pn, {})
        # The km-stand: the withdrawal reading before the cutoff when there is
        # one; else the next insertion reading after it.
        if b:
            km, at, src = b['odo_end'], b['last_use'], 'before'
        elif a:
            km, at, src = a['odo_begin'], a['first_use'], 'after'
        else:
            continue
        gap_days = _days_between(at, cutoff)
        exact = at[:10] == cutoff[:10] or (src == 'after' and at[:10] == f'{year + 1}-01-01')
        if exact or (gap_days is not None and gap_days <= 3):
            quality = 'exact'
        elif gap_days is not None and gap_days <= 14:
            quality = 'ok'
        else:
            quality = 'gap'
        bracket_km = (a['odo_begin'] - b['odo_end']) if (a and b) else None
        bracket_days = _days_between(b['last_use'], a['first_use']) if (a and b) else None
        km_prev = p['odo_end'] if p else None
        active = int(act.get('n') or 0) > 0
        # Distance in the year only makes sense when the vehicle was used in it
        # and both year-end readings exist.
        km_in_year = (km - km_prev) if (active and km_prev is not None and km >= km_prev) else None
        rows.append({
            'plate_norm': pn,
            'plate': spelling.get(pn, (0, pn))[1],
            'nation': (b or a or {}).get('nation', ''),
            'vin': (b or a or {}).get('vin', '') or '',
            'km': km,
            'at': at,
            'source': src,
            'driver': (b or a)['driver'],
            'card_number': (b or a)['card_number'],
            'gap_days': gap_days,
            'quality': quality,
            'before_km': b['odo_end'] if b else None,
            'before_at': b['last_use'] if b else '',
            'before_driver': b['driver'] if b else '',
            'after_km': a['odo_begin'] if a else None,
            'after_at': a['first_use'] if a else '',
            'after_driver': a['driver'] if a else '',
            'bracket_km': bracket_km,
            'bracket_days': bracket_days,
            'km_prev_year': km_prev,
            'km_in_year': km_in_year,
            'active_in_year': active,
            'records_in_year': int(act.get('n') or 0),
            'drivers_in_year': int(act.get('drivers') or 0),
            'first_seen_in_year': act.get('lo') or '',
            'last_seen_in_year': act.get('hi') or '',
            'odo_min_in_year': act.get('odo_lo'),
            'odo_max_in_year': act.get('odo_hi'),
        })
    rows.sort(key=lambda r: r['plate'])
    return {
        'year': year, 'cutoff': cutoff, 'source': source, 'rows': rows,
        'counts': {
            'vehicles': len(rows),
            'active': sum(1 for r in rows if r['active_in_year']),
            'exact': sum(1 for r in rows if r['quality'] == 'exact'),
            'ok': sum(1 for r in rows if r['quality'] == 'ok'),
            'gap': sum(1 for r in rows if r['quality'] == 'gap'),
        },
    }


def vehicle_timeline(plate_norm: str, year: int, days: int = 45, source: str = 'drivers') -> dict:
    """All records of one vehicle around the year end (±days), plus totals."""
    cutoff_dt = datetime(year, 12, 31, 23, 59, 59, tzinfo=CET).astimezone(timezone.utc)
    lo = (cutoff_dt - timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    hi = (cutoff_dt + timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    with get_db() as db:
        rows = db.query(
            'SELECT plate, driver, card_number, odo_begin, odo_end, first_use, last_use, generation_hint FROM ('
            '  SELECT plate, driver, card_number, odo_begin, odo_end, first_use, last_use, 0 AS generation_hint '
            '  FROM card_vehicle_usage WHERE source = ? AND plate_norm = ? AND last_use >= ? AND first_use <= ?'
            ') t ORDER BY first_use',
            (source, plate_norm, lo, hi),
        )
        total = db.query_one('SELECT COUNT(*) AS n, MIN(first_use) AS lo, MAX(last_use) AS hi, COUNT(DISTINCT card_number) AS drivers '
                             'FROM card_vehicle_usage WHERE source = ? AND plate_norm = ?', (source, plate_norm))
    return {
        'plate_norm': plate_norm, 'year': year, 'cutoff': _cutoff(year),
        'records': [{k: r[k] for k in ('plate', 'driver', 'card_number', 'odo_begin', 'odo_end', 'first_use', 'last_use')} for r in rows],
        'total_records': int(total['n'] or 0), 'first_record': total['lo'] or '', 'last_record': total['hi'] or '',
        'drivers': int(total['drivers'] or 0),
    }


def list_files(limit: int = 200, only_errors: bool = False) -> list[dict]:
    with get_db() as db:
        if only_errors:
            rows = db.query('SELECT * FROM card_scan_files WHERE error <> ? ORDER BY scanned_at DESC LIMIT ?', ('', limit))
        else:
            rows = db.query('SELECT * FROM card_scan_files ORDER BY scanned_at DESC LIMIT ?', (limit,))
    return [dict(r) for r in rows]


def reset_all() -> None:
    with get_db() as db:
        db.execute('DELETE FROM card_vehicle_usage')
        db.execute('DELETE FROM card_scan_files')
        db.commit()
