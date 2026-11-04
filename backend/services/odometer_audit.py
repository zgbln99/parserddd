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
from core.card_vehicles import is_non_driver_card, parse_card_vehicles
from core.vu_odometer import is_vu_file, parse_vu
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
CARD_EXTS = ('.ddd', '.c1b', '.esm', '.tgd', '.dat', '.v1b', '.v2b', '.vub')


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

# Historical LTS registrations. Do not use today's Samsara fleet here: vehicles
# that belonged to LTS in 2021 may have been sold and removed from Samsara.
LTS_PLATE_PREFIXES = ('TFLS', 'TFKX')


def source_group(detail: str) -> str:
    """card_scan_files.source (detailed) -> one of SOURCES."""
    if detail.startswith('mega:'):
        return 'mega'
    if detail in ('archive', 'upload'):
        return 'archive'
    return 'drivers'

def ensure_schema() -> None:
    """Non-destructively migrate v1 audit readings to separate source groups.

    The previous implementation dropped both audit tables and required a full
    rescan. Production can have tens of thousands of parsed readings, so
    preserve the scan cache and link each record to its original file source.
    This is called before database.init_db() creates the new source indexes.
    """
    from database import get_engine
    engine = get_engine()
    with get_db() as db:
        if engine == 'postgresql':
            cols = [r['column_name'] for r in db.query(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'card_vehicle_usage'")]
            if cols and 'source' not in cols:
                db.execute("ALTER TABLE card_vehicle_usage ADD COLUMN source TEXT NOT NULL DEFAULT 'drivers'")
                db.execute(
                    "UPDATE card_vehicle_usage AS u SET source = CASE "
                    "WHEN f.source LIKE 'mega:%' THEN 'mega' "
                    "WHEN f.source IN ('archive', 'upload') THEN 'archive' ELSE 'drivers' END "
                    "FROM card_scan_files AS f WHERE f.id = u.file_id"
                )
                db.execute(
                    'CREATE UNIQUE INDEX IF NOT EXISTS idx_cvu_source_unique '
                    'ON card_vehicle_usage (source, card_number, plate_norm, first_use, last_use)'
                )
                db.commit()
                logger.info('odometer audit: PostgreSQL source column added without discarding readings')
            return

        # Lock before checking schema so two Gunicorn workers never migrate
        # the same table concurrently. All table replacement is one transaction.
        db.execute('BEGIN IMMEDIATE')
        cols = [r['name'] for r in db.query('PRAGMA table_info(card_vehicle_usage)')]
        if not cols or 'source' in cols:
            db.commit()
            return

        old_count = db.query_one('SELECT COUNT(*) AS n FROM card_vehicle_usage')['n']
        db.execute(
            "CREATE TABLE card_vehicle_usage_v2 ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "source TEXT NOT NULL DEFAULT 'drivers',"
            "card_number TEXT NOT NULL DEFAULT '',"
            "driver TEXT NOT NULL DEFAULT '',"
            "plate_norm TEXT NOT NULL,"
            "plate TEXT NOT NULL,"
            "nation TEXT NOT NULL DEFAULT '',"
            "vin TEXT NOT NULL DEFAULT '',"
            "odo_begin INTEGER NOT NULL,"
            "odo_end INTEGER NOT NULL,"
            "first_use TEXT NOT NULL,"
            "last_use TEXT NOT NULL,"
            "file_id INTEGER NOT NULL DEFAULT 0,"
            "UNIQUE (source, card_number, plate_norm, first_use, last_use)"
            ")"
        )
        db.execute(
            "INSERT INTO card_vehicle_usage_v2 "
            "(id, source, card_number, driver, plate_norm, plate, nation, vin, "
            "odo_begin, odo_end, first_use, last_use, file_id) "
            "SELECT u.id, CASE "
            "WHEN f.source LIKE 'mega:%' THEN 'mega' "
            "WHEN f.source IN ('archive', 'upload') THEN 'archive' "
            "ELSE 'drivers' END, "
            "u.card_number, u.driver, u.plate_norm, u.plate, u.nation, u.vin, "
            "u.odo_begin, u.odo_end, u.first_use, u.last_use, u.file_id "
            "FROM card_vehicle_usage AS u "
            "LEFT JOIN card_scan_files AS f ON f.id = u.file_id"
        )
        new_count = db.query_one('SELECT COUNT(*) AS n FROM card_vehicle_usage_v2')['n']
        if new_count != old_count:
            raise RuntimeError(f'odometer audit migration mismatch: {old_count} -> {new_count}')
        db.execute('DROP TABLE card_vehicle_usage')
        db.execute('ALTER TABLE card_vehicle_usage_v2 RENAME TO card_vehicle_usage')
        db.commit()
        logger.info('odometer audit: kept %d readings while splitting data sources', new_count)


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
    """Parse one tachograph file (driver card or vehicle unit, told apart by
    content) and store what it says about vehicles. Returns a summary."""
    if is_vu_file(data):
        return _ingest_vu(path, data, source=source, size=size)
    size = len(data) if size is None else size
    error = ''
    parsed = {'card_number': '', 'holder': '', 'records': []}
    kind = 'card'
    try:
        parsed = parse_card_vehicles(data)
        if not parsed['records'] and not parsed['card_number']:
            if is_non_driver_card(data):
                # A real non-driver tachograph card, but no EF_Vehicles_Used.
                # Save it as not applicable; do not flood the error list.
                kind = 'other'
            else:
                error = 'no vehicle records (not a driver card or VU download?)'
    except Exception as exc:  # defensive: one bad file must not stop the scan
        error = f'parse error: {exc}'
    card = parsed.get('card_number') or ''
    holder = parsed.get('holder') or ''
    driver = driver or holder
    records = parsed.get('records') or []
    group = source_group(source)
    with get_db() as db:
        file_id = _upsert_file(db, path, size, source, kind, driver, card, holder, '', len(records), error)
        inserted = _store_usage(db, group, card, driver, records, file_id)
        db.commit()
    return {'path': path, 'kind': kind, 'card_number': card, 'holder': holder, 'records': len(records), 'new': inserted, 'error': error}


def _upsert_file(db, path, size, source, kind, driver, card, holder, plate, records, error) -> int:
    now = _now_iso()
    row = db.query_one('SELECT id FROM card_scan_files WHERE path = ?', (path,))
    if row:
        file_id = int(row['id'])
        db.execute(
            'UPDATE card_scan_files SET size = ?, source = ?, kind = ?, driver = ?, card_number = ?, holder = ?, plate = ?, '
            'records = ?, error = ?, scanned_at = ? WHERE id = ?',
            (size, source, kind, driver, card, holder, plate, records, error, now, file_id),
        )
        return file_id
    db.execute(
        'INSERT INTO card_scan_files (path, size, source, kind, driver, card_number, holder, plate, records, error, scanned_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (path, size, source, kind, driver, card, holder, plate, records, error, now),
    )
    return int(db.query_one('SELECT id FROM card_scan_files WHERE path = ?', (path,))['id'])


def _store_usage(db, group: str, card: str, driver: str, records: list, file_id: int) -> int:
    """Insert (card, vehicle, insertion window) rows not yet known for this source/card."""
    if not records:
        return 0
    existing = {
        (r['plate_norm'], r['first_use'], r['last_use'])
        for r in db.query('SELECT plate_norm, first_use, last_use FROM card_vehicle_usage WHERE source = ? AND card_number = ?', (group, card))
    }
    inserted = 0
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
            (group, card, rec.get('driver') or driver, pn, rec['plate'], rec.get('nation', ''), rec.get('vin', ''),
             rec['odo_begin'], rec['odo_end'], rec['first_use'], rec['last_use'], file_id),
        )
        inserted += 1
    return inserted


def _ingest_vu(path: str, data: bytes, *, source: str, size: int | None) -> dict:
    """A vehicle-unit download: the vehicle's own registration, the odometer
    at midnight of every downloaded day, and the card in/out records."""
    size = len(data) if size is None else size
    error = ''
    parsed = {'plate': '', 'nation': '', 'vin': '', 'days': [], 'card_records': [], 'warning': ''}
    try:
        parsed = parse_vu(data)
        if not parsed['plate']:
            error = 'vehicle unit file without registration (overview block missing?)'
        elif parsed.get('warning'):
            error = ''  # partial read is fine; the warning is kept in the result
    except Exception as exc:
        error = f'parse error: {exc}'
    plate = parsed.get('plate') or ''
    pn = normalize_plate(plate)
    group = source_group(source)
    days = parsed.get('days') or []
    recs = parsed.get('card_records') or []
    n_new_days = n_new_recs = 0
    with get_db() as db:
        file_id = _upsert_file(db, path, size, source, 'vu', '', '', parsed.get('vin') or '', plate,
                               len(days) + len(recs), error)
        if pn and days:
            known = {r['day'] for r in db.query('SELECT day FROM vu_odometer_days WHERE source = ? AND plate_norm = ?', (group, pn))}
            for d in days:
                if d['day'] in known:
                    continue
                known.add(d['day'])
                db.execute(
                    'INSERT INTO vu_odometer_days (source, plate_norm, plate, nation, vin, day, at, odo, file_id) '
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (group, pn, plate, parsed.get('nation') or '', parsed.get('vin') or '', d['day'], d['at'], d['odo'], file_id),
                )
                n_new_days += 1
        if pn and recs:
            by_card: dict[str, list] = {}
            for r in recs:
                by_card.setdefault(r['card_number'], []).append({
                    'plate': plate, 'nation': parsed.get('nation') or '', 'vin': parsed.get('vin') or '',
                    'odo_begin': r['odo_begin'], 'odo_end': r['odo_end'], 'first_use': r['first_use'], 'last_use': r['last_use'],
                    'driver': r['holder'],
                })
            for card, lst in by_card.items():
                n_new_recs += _store_usage(db, group, card, '', lst, file_id)
        db.commit()
    return {'path': path, 'kind': 'vu', 'plate': plate, 'card_number': '', 'holder': '', 'records': len(days) + len(recs),
            'new': n_new_days + n_new_recs, 'new_days': n_new_days, 'error': error, 'warning': parsed.get('warning') or ''}


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

    # Identify the file first so the stored copy lands in its folder:
    # cards under their card number, vehicle units under "VU_<plate>".
    sub = ''
    try:
        if is_vu_file(data):
            sub = 'VU_' + (normalize_plate(parse_vu(data).get('plate') or '') or 'unbekannt')
        else:
            sub = parse_card_vehicles(data).get('card_number') or ''
    except Exception:
        sub = ''
    folder = audit_folder()
    stored = keep and storage_service.is_configured()
    path = f"{folder}/{sub or 'unbekannt'}/{name}" if stored else f'upload/{name}'
    if _already_scanned(path, len(data)):
        return [{'path': path, 'status': 'skipped', 'error': '', 'records': 0, 'new': 0, 'card_number': sub}]
    if stored:
        try:
            storage_service.upload_bytes(path, data, content_type='application/octet-stream')
        except Exception as exc:
            return [{'path': path, 'status': 'error', 'error': f'storage: {exc}', 'records': 0, 'new': 0, 'card_number': sub}]
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
        kinds = db.query('SELECT source, kind, COUNT(*) AS n FROM card_scan_files GROUP BY source, kind')
        vu_days = db.query('SELECT source, COUNT(*) AS n, COUNT(DISTINCT plate_norm) AS plates, MIN(at) AS lo, MAX(at) AS hi FROM vu_odometer_days GROUP BY source')
    lo, hi = (usage['lo'] or ''), (usage['hi'] or '')
    years = list(range(int(lo[:4]), int(hi[:4]) + 1)) if lo and hi else []
    return {
        'files': int(files['n'] or 0), 'files_with_errors': int(files['bad'] or 0), 'last_scan': files['last'] or '',
        'records': int(usage['n'] or 0), 'plates': int(usage['plates'] or 0), 'cards': int(usage['cards'] or 0),
        'first_record': lo, 'last_record': hi, 'years': years,
        'errors': [dict(r) for r in recent_errors],
        'sources': {('drivers' if r['source'] == 'storage' else r['source']): int(r['n']) for r in by_source},
        'by_source': _by_source(per_source, by_source, kinds, vu_days),
        'audit_folder': audit_folder(),
        'extra_folders': get_extra_folders(),
        'storage_configured': storage_service.is_configured(),
        'scan': scan_status(),
    }


def _by_source(per_source, by_source, kinds, vu_days) -> dict:
    out: dict = {}
    def _grp(detail):
        return source_group('drivers' if detail == 'storage' else detail)
    groups = {_grp(r['source']) for r in by_source} | {r['source'] for r in per_source} | {r['source'] for r in vu_days}
    for g in groups:
        usage = next((r for r in per_source if r['source'] == g), None)
        vd = next((r for r in vu_days if r['source'] == g), None)
        lo = min(x for x in ((usage['lo'] if usage else ''), (vd['lo'] if vd else '')) if x) if (usage and usage['lo']) or (vd and vd['lo']) else ''
        hi = max(x for x in ((usage['hi'] if usage else ''), (vd['hi'] if vd else '')) if x) if (usage and usage['hi']) or (vd and vd['hi']) else ''
        out[g] = {
            'records': int(usage['n'] or 0) if usage else 0,
            'plates': int(usage['plates'] or 0) if usage else 0,
            'cards': int(usage['cards'] or 0) if usage else 0,
            'first_record': lo, 'last_record': hi,
            'files': sum(int(x['n']) for x in by_source if _grp(x['source']) == g),
            'card_files': sum(int(x['n']) for x in kinds if _grp(x['source']) == g and x['kind'] == 'card'),
            'vu_files': sum(int(x['n']) for x in kinds if _grp(x['source']) == g and x['kind'] == 'vu'),
            'vu_days': int(vd['n'] or 0) if vd else 0,
            'vu_plates': int(vd['plates'] or 0) if vd else 0,
        }
    return out


def _cutoff(year: int) -> str:
    """Last second of 31.12 local time, as the UTC string the records use."""
    local = datetime(year, 12, 31, 23, 59, 59, tzinfo=CET)
    return local.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _year_end_reading(db, year: int, lower_bound: str, source: str) -> dict[str, dict]:
    """plate_norm -> newest card record ending at or before the cutoff (odometer at withdrawal)."""
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
    """plate_norm -> oldest card record starting after the cutoff (odometer at insertion)."""
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


def _vu_before(db, cutoff: str, lower_bound: str, source: str) -> dict[str, dict]:
    rows = db.query(
        'SELECT v.* FROM vu_odometer_days v JOIN ('
        '  SELECT plate_norm, MAX(at) AS a FROM vu_odometer_days WHERE source = ? AND at <= ? AND at >= ? GROUP BY plate_norm'
        ') m ON m.plate_norm = v.plate_norm AND m.a = v.at WHERE v.source = ?',
        (source, cutoff, lower_bound, source),
    )
    return {r['plate_norm']: dict(r) for r in rows}


def _vu_after(db, cutoff: str, upper_bound: str, source: str) -> dict[str, dict]:
    rows = db.query(
        'SELECT v.* FROM vu_odometer_days v JOIN ('
        '  SELECT plate_norm, MIN(at) AS a FROM vu_odometer_days WHERE source = ? AND at > ? AND at <= ? GROUP BY plate_norm'
        ') m ON m.plate_norm = v.plate_norm AND m.a = v.at WHERE v.source = ?',
        (source, cutoff, upper_bound, source),
    )
    return {r['plate_norm']: dict(r) for r in rows}


def _reading(kind: str, km: int, at: str, driver: str = '', card: str = '') -> dict:
    return {'kind': kind, 'km': int(km), 'at': at, 'driver': driver or '', 'card_number': card or ''}


def _best_before(card_rec, vu_rec) -> dict | None:
    """Later of: card withdrawal reading, VU midnight reading."""
    cands = []
    if card_rec:
        cands.append(_reading('withdrawal', card_rec['odo_end'], card_rec['last_use'], card_rec['driver'], card_rec['card_number']))
    if vu_rec:
        cands.append(_reading('midnight', vu_rec['odo'], vu_rec['at']))
    return max(cands, key=lambda c: c['at']) if cands else None


def _best_after(card_rec, vu_rec) -> dict | None:
    """Earlier of: card insertion reading, VU midnight reading."""
    cands = []
    if card_rec:
        cands.append(_reading('insertion', card_rec['odo_begin'], card_rec['first_use'], card_rec['driver'], card_rec['card_number']))
    if vu_rec:
        cands.append(_reading('midnight', vu_rec['odo'], vu_rec['at']))
    return min(cands, key=lambda c: c['at']) if cands else None


def _days_between(a: str, b: str) -> float | None:
    try:
        da = datetime.strptime(a, '%Y-%m-%dT%H:%M:%SZ')
        dbb = datetime.strptime(b, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        return None
    return round(abs((dbb - da).total_seconds()) / 86400, 1)


def _year_end_value(before: dict | None, after: dict | None, cutoff: str) -> tuple[dict | None, str]:
    """The km-stand to report and where it comes from.

    A VU reading at midnight on 1 January wins as the boundary reading.
    Otherwise choose the reading with the smallest time difference from
    31 December 23:59:59 Europe/Berlin (before wins exact ties).
    """
    if after and after['kind'] == 'midnight':
        gap = _days_between(after['at'], cutoff)
        if gap is not None and gap <= 0.2:
            return after, 'midnight'
    if not before:
        return (after, 'after') if after else (None, '')
    if not after:
        return before, 'before'
    # Choose the nearest real reading on EITHER side of year-end; a December
    # withdrawal is not automatically better than a January insertion.
    boundary = datetime.strptime(cutoff, '%Y-%m-%dT%H:%M:%SZ')
    before_gap = abs((datetime.strptime(before['at'], '%Y-%m-%dT%H:%M:%SZ') - boundary).total_seconds())
    after_gap = abs((datetime.strptime(after['at'], '%Y-%m-%dT%H:%M:%SZ') - boundary).total_seconds())
    return (before, 'before') if before_gap <= after_gap else (after, 'after')


def year_report(year: int, source: str = 'drivers') -> dict:
    """Per vehicle: odometer on 31.12 of `year` (or nearest), with context.
    Only records of ONE source are used; card and VU readings are merged."""
    if source not in SOURCES:
        raise ValueError('unknown source')
    cutoff = _cutoff(year)
    lower = f'{year - 1}-01-01T00:00:00Z'       # vehicles not seen for over a year are left out
    upper = f'{year + 1}-12-31T23:59:59Z'
    prev_cutoff = _cutoff(year - 1)
    with get_db() as db:
        before_c = _year_end_reading(db, year, lower, source)
        after_c = _next_reading(db, year, upper, source)
        before_v = _vu_before(db, cutoff, lower, source)
        after_v = _vu_after(db, cutoff, upper, source)
        prev_c = _year_end_reading(db, year - 1, f'{year - 2}-01-01T00:00:00Z', source)
        prev_v = _vu_before(db, prev_cutoff, f'{year - 2}-01-01T00:00:00Z', source)
        prev_after_v = _vu_after(db, prev_cutoff, f'{year}-12-31T23:59:59Z', source)
        # Display form of each plate: the spelling seen most often.
        spell_rows = db.query('SELECT plate_norm, plate, COUNT(*) AS n FROM card_vehicle_usage WHERE source = ? GROUP BY plate_norm, plate', (source,))
        spell_vu = db.query('SELECT plate_norm, plate, COUNT(*) AS n FROM vu_odometer_days WHERE source = ? GROUP BY plate_norm, plate', (source,))
        # Activity within the year.
        act_rows = db.query(
            'SELECT plate_norm, COUNT(*) AS n, COUNT(DISTINCT card_number) AS drivers, MIN(first_use) AS lo, MAX(last_use) AS hi, '
            'MIN(odo_begin) AS odo_lo, MAX(odo_end) AS odo_hi FROM card_vehicle_usage '
            'WHERE source = ? AND last_use >= ? AND first_use <= ? GROUP BY plate_norm',
            (source, f'{year}-01-01T00:00:00Z', cutoff),
        )
        vu_rows = db.query(
            'SELECT plate_norm, COUNT(*) AS n, MIN(at) AS lo, MAX(at) AS hi, MIN(odo) AS odo_lo, MAX(odo) AS odo_hi, MAX(vin) AS vin '
            'FROM vu_odometer_days WHERE source = ? AND at >= ? AND at <= ? GROUP BY plate_norm',
            (source, f'{year}-01-01T00:00:00Z', cutoff),
        )
    spelling: dict[str, tuple[int, str]] = {}
    for r in list(spell_rows) + list(spell_vu):
        if int(r['n']) > spelling.get(r['plate_norm'], (0, ''))[0]:
            spelling[r['plate_norm']] = (int(r['n']), r['plate'])
    activity = {r['plate_norm']: dict(r) for r in act_rows}
    vu_activity = {r['plate_norm']: dict(r) for r in vu_rows}

    plates = set(before_c) | set(after_c) | set(before_v) | set(after_v) | set(activity) | set(vu_activity)
    rows = []
    for pn in plates:
        # The driver archive contains other carriers' trucks. The annual
        # LTS report must only show known company registration series.
        if not pn.startswith(LTS_PLATE_PREFIXES):
            continue
        before = _best_before(before_c.get(pn), before_v.get(pn))
        after = _best_after(after_c.get(pn), after_v.get(pn))
        chosen, src = _year_end_value(before, after, cutoff)
        if not chosen:
            continue
        act = activity.get(pn, {})
        vact = vu_activity.get(pn, {})
        km, at = chosen['km'], chosen['at']
        gap_days = 0.0 if src == 'midnight' else _days_between(at, cutoff)
        # A close reading is not an exact 31.12 odometer reading. Compare the
        # calendar day in the audit's local timezone, not the UTC date.
        at_local_day = datetime.strptime(at, '%Y-%m-%dT%H:%M:%SZ').replace(
            tzinfo=timezone.utc).astimezone(CET).strftime('%Y-%m-%d')
        exact = src == 'midnight' or at_local_day == f'{year}-12-31'
        if exact:
            quality = 'exact'
        elif gap_days is not None and gap_days <= 14:
            quality = 'ok'
        else:
            quality = 'gap'
        prev_chosen, _ = _year_end_value(_best_before(prev_c.get(pn), prev_v.get(pn)), _best_after(None, prev_after_v.get(pn)), prev_cutoff)
        km_prev = prev_chosen['km'] if prev_chosen else None
        active = int(act.get('n') or 0) > 0 or int(vact.get('n') or 0) > 0
        km_in_year = (km - km_prev) if (active and km_prev is not None and km >= km_prev) else None
        any_rec = before_c.get(pn) or after_c.get(pn) or {}
        rows.append({
            'plate_norm': pn,
            'plate': spelling.get(pn, (0, pn))[1],
            'nation': any_rec.get('nation', '') or (before_v.get(pn) or after_v.get(pn) or {}).get('nation', ''),
            'vin': (any_rec.get('vin') or vact.get('vin') or (before_v.get(pn) or after_v.get(pn) or {}).get('vin') or ''),
            'km': km,
            'at': at,
            'source': src,
            'kind': chosen['kind'],
            'driver': chosen['driver'],
            'card_number': chosen['card_number'],
            'gap_days': gap_days,
            'quality': quality,
            'before_km': before['km'] if before else None,
            'before_at': before['at'] if before else '',
            'before_kind': before['kind'] if before else '',
            'before_driver': before['driver'] if before else '',
            'after_km': after['km'] if after else None,
            'after_at': after['at'] if after else '',
            'after_kind': after['kind'] if after else '',
            'after_driver': after['driver'] if after else '',
            'bracket_km': (after['km'] - before['km']) if (after and before) else None,
            'bracket_days': _days_between(before['at'], after['at']) if (after and before) else None,
            'km_prev_year': km_prev,
            'km_in_year': km_in_year,
            'active_in_year': active,
            'records_in_year': int(act.get('n') or 0),
            'vu_days_in_year': int(vact.get('n') or 0),
            'drivers_in_year': int(act.get('drivers') or 0),
            'first_seen_in_year': min(x for x in (act.get('lo') or '', vact.get('lo') or '') if x) if (act.get('lo') or vact.get('lo')) else '',
            'last_seen_in_year': max(x for x in (act.get('hi') or '', vact.get('hi') or '') if x) if (act.get('hi') or vact.get('hi')) else '',
            'odo_min_in_year': min(x for x in (act.get('odo_lo'), vact.get('odo_lo')) if x is not None) if (act.get('odo_lo') is not None or vact.get('odo_lo') is not None) else None,
            'odo_max_in_year': max(x for x in (act.get('odo_hi'), vact.get('odo_hi')) if x is not None) if (act.get('odo_hi') is not None or vact.get('odo_hi') is not None) else None,
        })
    # Show the most useful readings first, not historical readings hundreds
    # of days away from year-end. Stable registration order for equal gaps.
    rows.sort(key=lambda r: (r['gap_days'] if r['gap_days'] is not None else float('inf'), r['plate_norm']))
    return {
        'year': year, 'cutoff': cutoff, 'source': source, 'rows': rows,
        'counts': {
            'vehicles': len(rows),
            'active': sum(1 for r in rows if r['active_in_year']),
            'exact': sum(1 for r in rows if r['quality'] == 'exact'),
            'ok': sum(1 for r in rows if r['quality'] == 'ok'),
            'gap': sum(1 for r in rows if r['quality'] == 'gap'),
            'from_vu': sum(1 for r in rows if r['kind'] == 'midnight'),
        },
    }


def vehicle_timeline(plate_norm: str, year: int, days: int = 45, source: str = 'drivers') -> dict:
    """All readings of one vehicle around the year end (±days): card in/out
    records and VU midnight odometers, plus totals."""
    cutoff_dt = datetime(year, 12, 31, 23, 59, 59, tzinfo=CET).astimezone(timezone.utc)
    lo = (cutoff_dt - timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    hi = (cutoff_dt + timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    with get_db() as db:
        rows = db.query(
            'SELECT plate, driver, card_number, odo_begin, odo_end, first_use, last_use FROM card_vehicle_usage '
            'WHERE source = ? AND plate_norm = ? AND last_use >= ? AND first_use <= ? ORDER BY first_use',
            (source, plate_norm, lo, hi),
        )
        vrows = db.query(
            'SELECT plate, day, at, odo FROM vu_odometer_days WHERE source = ? AND plate_norm = ? AND at >= ? AND at <= ? ORDER BY at',
            (source, plate_norm, lo, hi),
        )
        total = db.query_one('SELECT COUNT(*) AS n, MIN(first_use) AS lo, MAX(last_use) AS hi, COUNT(DISTINCT card_number) AS drivers '
                             'FROM card_vehicle_usage WHERE source = ? AND plate_norm = ?', (source, plate_norm))
        vtotal = db.query_one('SELECT COUNT(*) AS n, MIN(at) AS lo, MAX(at) AS hi FROM vu_odometer_days WHERE source = ? AND plate_norm = ?', (source, plate_norm))
    records = [
        {'kind': 'card', 'plate': r['plate'], 'driver': r['driver'], 'card_number': r['card_number'],
         'odo_begin': r['odo_begin'], 'odo_end': r['odo_end'], 'first_use': r['first_use'], 'last_use': r['last_use']}
        for r in rows
    ] + [
        {'kind': 'midnight', 'plate': r['plate'], 'driver': '', 'card_number': '',
         'odo_begin': r['odo'], 'odo_end': r['odo'], 'first_use': r['at'], 'last_use': r['at']}
        for r in vrows
    ]
    records.sort(key=lambda r: (r['first_use'], r['kind']))
    los = [x for x in (total['lo'], vtotal['lo']) if x]
    his = [x for x in (total['hi'], vtotal['hi']) if x]
    return {
        'plate_norm': plate_norm, 'year': year, 'cutoff': _cutoff(year), 'records': records,
        'total_records': int(total['n'] or 0), 'vu_days': int(vtotal['n'] or 0),
        'first_record': min(los) if los else '', 'last_record': max(his) if his else '',
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
        db.execute('DELETE FROM vu_odometer_days')
        db.execute('DELETE FROM card_scan_files')
        db.commit()
