"""Driver-card file archive for people outside the dispatch team.

An admin creates a share link (label + password, optional expiry) in
Admin → "Linki do plików". The person who gets the link opens
``/share/<token>``, enters the password once per browser session and can then
browse the ``{SYNC_DEST_FOLDER}/{driver}/{file}.ddd`` archive: list drivers,
download single files, or a ZIP per driver (all files or one month).

Unlocking stores only ``session['file_shares']`` (a list of unlocked tokens);
it never sets ``logged_in``, so a share password gives no access to the app.
Failed password attempts share the login throttle (login_attempts table).

Endpoints:
    Admin (admin role)
        GET    /api/file-shares
        POST   /api/file-shares            {label, password, expires_in_days}
        PATCH  /api/file-shares/<id>       {enabled?, password?, label?, expires_in_days?}
        DELETE /api/file-shares/<id>
    Public (token + password)
        GET    /api/share/<token>          link info + whether this session is unlocked
        POST   /api/share/<token>/unlock   {password}
        POST   /api/share/<token>/lock
        GET    /api/share/<token>/files    drivers with their files (cached, ?refresh=1)
        GET    /api/share/<token>/download?path=...
        GET    /api/share/<token>/zip?driver=...&month=YYYY-MM
"""

import io
import logging
import os
import re
import zipfile
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request, send_file, session

from auth.decorators import admin_required
from auth.helpers import _check_rate_limit, _clear_rate_limit, _log_activity, _record_failed_login
from services import file_share_service as svc
from services.drivers_index import build_drivers_data, get_storage_client, load_portal_cache, save_portal_cache

bp = Blueprint('fileshare', __name__)
logger = logging.getLogger(__name__)

_SESSION_KEY = 'file_shares'
_SAFE_SEGMENT = re.compile(r'^[^/\\\x00]{1,200}$')


def _sync_folder() -> str:
    return os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD').rstrip('/')


def _public_url(token: str) -> str:
    return f"{request.host_url.rstrip('/')}/share/{token}"


def _share_dict(s: dict) -> dict:
    return {
        'id': s['id'],
        'token': s['token'],
        'label': s['label'],
        'enabled': s['enabled'],
        'created_by': s['created_by'],
        'created_at': s['created_at'],
        'expires_at': s['expires_at'],
        'last_access': s['last_access'],
        'access_count': s['access_count'],
        'download_count': s['download_count'],
        'url': _public_url(s['token']),
        'expired': svc.is_expired(s),
    }


def _expiry_from_days(raw) -> str:
    try:
        days = int(raw or 0)
    except (TypeError, ValueError):
        days = 0
    if days <= 0:
        return ''
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

@bp.route('/api/file-shares', methods=['GET'])
@admin_required
def api_file_shares_list():
    return jsonify({'shares': [_share_dict(s) for s in svc.list_shares()]})


@bp.route('/api/file-shares', methods=['POST'])
@admin_required
def api_file_shares_create():
    data = request.get_json(silent=True) or {}
    label = (data.get('label') or '').strip()
    password = data.get('password') or ''
    if not label:
        return jsonify({'error': 'Podaj nazwę linku / Bitte Namen angeben'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Hasło: minimum 6 znaków / Passwort: mindestens 6 Zeichen'}), 400
    share = svc.create_share(
        label=label, password=password,
        expires_at=_expiry_from_days(data.get('expires_in_days')),
        created_by=session.get('username') or 'admin',
    )
    _log_activity('file_share_create', f"{label} ({share['token']})")
    return jsonify(_share_dict(share))


@bp.route('/api/file-shares/<int:share_id>', methods=['PATCH'])
@admin_required
def api_file_shares_update(share_id):
    s = svc.get_by_id(share_id)
    if not s:
        return jsonify({'error': 'not found'}), 404
    data = request.get_json(silent=True) or {}
    password = data.get('password')
    if password is not None and len(password) < 6:
        return jsonify({'error': 'Hasło: minimum 6 znaków / Passwort: mindestens 6 Zeichen'}), 400
    svc.update_share(
        share_id,
        enabled=bool(data['enabled']) if 'enabled' in data else None,
        password=password,
        label=(data.get('label') or '').strip() if 'label' in data else None,
        expires_at=_expiry_from_days(data.get('expires_in_days')) if 'expires_in_days' in data else None,
    )
    changed = [k for k in ('enabled', 'password', 'label', 'expires_in_days') if k in data]
    _log_activity('file_share_update', f"{s['label']}: {', '.join(changed)}")
    return jsonify(_share_dict(svc.get_by_id(share_id)))


@bp.route('/api/file-shares/<int:share_id>', methods=['DELETE'])
@admin_required
def api_file_shares_delete(share_id):
    s = svc.get_by_id(share_id)
    svc.delete_share(share_id)
    _log_activity('file_share_delete', s['label'] if s else str(share_id))
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Public (token + password)
# ---------------------------------------------------------------------------

def _unlocked(token: str) -> bool:
    return token in (session.get(_SESSION_KEY) or [])


def _live_share(token: str):
    s = svc.get_by_token(token)
    if not svc.is_live(s):
        return None
    return s


def _require_unlocked(token: str):
    """Returns (share, error_response)."""
    s = _live_share(token)
    if not s:
        return None, (jsonify({'error': 'Link nieaktywny lub wygasł / Link inaktiv oder abgelaufen'}), 404)
    if not _unlocked(token):
        return None, (jsonify({'error': 'password required', 'locked': True}), 401)
    return s, None


@bp.route('/api/share/<token>', methods=['GET'])
def api_share_info(token):
    s = _live_share(token)
    if not s:
        return jsonify({'error': 'Link nieaktywny lub wygasł / Link inaktiv oder abgelaufen'}), 404
    return jsonify({'label': s['label'], 'unlocked': _unlocked(token)})


@bp.route('/api/share/<token>/unlock', methods=['POST'])
def api_share_unlock(token):
    s = _live_share(token)
    if not s:
        return jsonify({'error': 'Link nieaktywny lub wygasł / Link inaktiv oder abgelaufen'}), 404
    ip = request.remote_addr or ''
    if _check_rate_limit(ip):
        return jsonify({'error': 'Zbyt wiele prób, spróbuj za 5 minut / Zu viele Versuche, in 5 Minuten erneut'}), 429
    data = request.get_json(silent=True) or {}
    if not svc.verify_password(s, data.get('password') or ''):
        _record_failed_login(ip)
        _log_activity('file_share_bad_password', f"{s['label']} from {ip}")
        return jsonify({'error': 'Nieprawidłowe hasło / Falsches Passwort'}), 401
    _clear_rate_limit(ip)
    unlocked = [t for t in (session.get(_SESSION_KEY) or []) if t != token]
    unlocked.append(token)
    session[_SESSION_KEY] = unlocked[-10:]
    svc.touch_access(token)
    _log_activity('file_share_open', f"{s['label']} from {ip}")
    return jsonify({'ok': True, 'label': s['label']})


@bp.route('/api/share/<token>/lock', methods=['POST'])
def api_share_lock(token):
    session[_SESSION_KEY] = [t for t in (session.get(_SESSION_KEY) or []) if t != token]
    return jsonify({'ok': True})


def _drivers(refresh: bool):
    """Driver list with files, from the portal cache unless refresh is asked."""
    if not refresh:
        cached = load_portal_cache()
        if cached is not None:
            return cached
    dbx = get_storage_client()
    if not dbx:
        raise RuntimeError('Storage nie skonfigurowany / Speicher nicht konfiguriert')
    drivers = build_drivers_data(dbx, _sync_folder())
    save_portal_cache(drivers)
    return drivers


def _public_driver(d: dict) -> dict:
    return {
        'name': d.get('name', ''),
        'card_number': d.get('card_number', ''),
        'file_count': len(d.get('files') or []),
        'latest_date': d.get('latest_date', ''),
        'earliest_date': d.get('earliest_date', ''),
        'files': [
            {
                'name': f.get('name', ''),
                'path': f.get('path', ''),
                'size': f.get('size', 0),
                'file_date': f.get('file_date', ''),
                'modified': f.get('modified', ''),
            }
            for f in (d.get('files') or [])
        ],
    }


@bp.route('/api/share/<token>/files', methods=['GET'])
def api_share_files(token):
    s, err = _require_unlocked(token)
    if err:
        return err
    try:
        drivers = _drivers(request.args.get('refresh') == '1')
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
    out = sorted((_public_driver(d) for d in drivers), key=lambda d: d['name'].lower())
    return jsonify({'label': s['label'], 'folder': _sync_folder(), 'drivers': out})


def _safe_file_path(path: str) -> str | None:
    """Only ``{sync}/{driver}/{file}.ddd`` paths are served, nothing else."""
    base = _sync_folder()
    if not path or not path.startswith(base + '/'):
        return None
    rel = path[len(base) + 1:]
    parts = rel.split('/')
    if len(parts) != 2 or not all(_SAFE_SEGMENT.match(p) and p not in ('.', '..') for p in parts):
        return None
    if not parts[1].lower().endswith('.ddd'):
        return None
    return f'{base}/{parts[0]}/{parts[1]}'


@bp.route('/api/share/<token>/download', methods=['GET'])
def api_share_download(token):
    s, err = _require_unlocked(token)
    if err:
        return err
    path = _safe_file_path(request.args.get('path') or '')
    if not path:
        return jsonify({'error': 'Nieprawidłowa ścieżka / Ungültiger Pfad'}), 400
    dbx = get_storage_client()
    if not dbx:
        return jsonify({'error': 'Storage nie skonfigurowany / Speicher nicht konfiguriert'}), 500
    try:
        meta, response = dbx.files_download(path)
    except Exception as exc:
        return jsonify({'error': str(exc)}), 404
    svc.bump_downloads(token)
    _log_activity('file_share_download', f"{s['label']}: {path}")
    name = getattr(meta, 'name', '') or path.rsplit('/', 1)[-1]
    return send_file(io.BytesIO(response.content), as_attachment=True,
                     download_name=name, mimetype='application/octet-stream')


@bp.route('/api/share/<token>/zip', methods=['GET'])
def api_share_zip(token):
    s, err = _require_unlocked(token)
    if err:
        return err
    driver = (request.args.get('driver') or '').strip()
    month = (request.args.get('month') or '').strip()  # YYYY-MM or ''
    if not driver or not _SAFE_SEGMENT.match(driver):
        return jsonify({'error': 'Podaj kierowcę / Fahrer angeben'}), 400
    if month and not re.match(r'^\d{4}-\d{2}$', month):
        return jsonify({'error': 'month must be YYYY-MM'}), 400
    try:
        drivers = _drivers(False)
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
    d = next((x for x in drivers if x.get('name') == driver), None)
    if not d:
        return jsonify({'error': 'Nie znaleziono kierowcy / Fahrer nicht gefunden'}), 404
    files = [f for f in (d.get('files') or []) if not month or (f.get('file_date') or '').startswith(month)]
    if not files:
        return jsonify({'error': 'Brak plików w tym okresie / Keine Dateien in diesem Zeitraum'}), 404
    if len(files) > 500:
        return jsonify({'error': 'Za dużo plików, wybierz miesiąc / Zu viele Dateien, Monat wählen'}), 400
    dbx = get_storage_client()
    if not dbx:
        return jsonify({'error': 'Storage nie skonfigurowany / Speicher nicht konfiguriert'}), 500

    buf = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            path = _safe_file_path(f.get('path') or '')
            if not path:
                continue
            try:
                _, response = dbx.files_download(path)
            except Exception:
                logger.warning('file share zip: cannot download %s', path)
                continue
            zf.writestr(f"{driver}/{f.get('name') or path.rsplit('/', 1)[-1]}", response.content)
            added += 1
    if not added:
        return jsonify({'error': 'Nie udało się pobrać plików / Dateien konnten nicht geladen werden'}), 500
    buf.seek(0)
    svc.bump_downloads(token, added)
    _log_activity('file_share_zip', f"{s['label']}: {driver} {month or 'all'} ({added})")
    safe_driver = re.sub(r'[^\w.-]+', '_', driver, flags=re.UNICODE).strip('_') or 'driver'
    return send_file(buf, as_attachment=True, mimetype='application/zip',
                     download_name=f"{safe_driver}_{month or 'all'}.zip")
