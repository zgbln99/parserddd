"""
Analysis Blueprint — file upload analysis, preview, Dropbox analysis, compare.
"""

import hashlib
import json as _json
import os
import tempfile
import time

from flask import Blueprint, request, jsonify

from auth.decorators import login_required
from auth.helpers import _log_activity, _get_db, _load_config
from core.constants import DRIVING, WORK, REST
from core.parsers import parse_ddd_auto
from core.extractors import (
    get_driver_info, get_activity_records, get_vehicle_records,
    get_card_places, get_card_events,
)
from core.timeline import build_timeline
from core.analysis import analyze_card
from services.dropbox_service import get_server_dropbox_client

bp = Blueprint('analysis', __name__)

# ---------------------------------------------------------------------------
# In-memory analysis cache: key = hash(file_content + flags) → result dict
# ---------------------------------------------------------------------------
_analysis_cache: dict[str, tuple[float, dict]] = {}
_CACHE_MAX_AGE = 3600  # 1 hour
_CACHE_MAX_SIZE = 50


def _cache_key(file_content: bytes, flags: dict) -> str:
    h = hashlib.md5(file_content, usedforsecurity=False)
    h.update(_json.dumps(flags, sort_keys=True).encode())
    return h.hexdigest()


def _cache_get(key: str) -> dict | None:
    entry = _analysis_cache.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_MAX_AGE:
        return entry[1]
    if entry:
        _analysis_cache.pop(key, None)
    return None


def _cache_set(key: str, result: dict):
    if len(_analysis_cache) >= _CACHE_MAX_SIZE:
        oldest = min(_analysis_cache, key=lambda k: _analysis_cache[k][0])
        _analysis_cache.pop(oldest, None)
    _analysis_cache[key] = (time.time(), result)


def _get_driver_analysis_flags(data):
    """Look up analysis flags from driver_config (per-driver) and global config."""
    flags = {'night_40_check_midnight': True, 'pause_cap_enabled': False, 'weekend_diet': False, 'night_includes_breaks': False}
    try:
        # Per-driver flags
        di = get_driver_info(data)
        card_number = di.get('card_number', '')
        if card_number:
            conn = _get_db()
            row = conn.execute('SELECT night_40_enabled FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()
            conn.close()
            if row:
                flags['night_40_check_midnight'] = bool(row['night_40_enabled'])
        # Global flags
        cfg = _load_config()
        flags['pause_cap_enabled'] = bool(cfg.get('pause_cap_enabled', False))
        flags['weekend_diet'] = bool(cfg.get('weekend_diet', False))
        flags['night_includes_breaks'] = bool(cfg.get('night_includes_breaks', False))
    except Exception:
        pass
    return flags


def _cache_card_expiry(card_number, card_expiry_date, driver_name=''):
    """Cache card_expiry_date in driver_config (upsert)."""
    if not card_number or not card_expiry_date:
        return
    from datetime import datetime
    now = datetime.utcnow().isoformat()
    conn = _get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM driver_config WHERE card_number = ?", (card_number,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE driver_config SET card_expiry_date = ?, updated_at = ? WHERE card_number = ?",
                (card_expiry_date, now, card_number),
            )
        else:
            conn.execute(
                "INSERT INTO driver_config (card_number, driver_name, card_expiry_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (card_number, driver_name, card_expiry_date, now, now),
            )
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


@bp.route('/api/analyze', methods=['POST'])
@login_required
def api_analyze_upload():
    """Upload a .ddd file and return analysis."""
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nie wybrano pliku'}), 400
    try:
        file_content = file.read()
        cfg = _load_config()
        global_flags = {
            'night_start_hour': int(cfg.get('night_start_hour', 22)),
            'pause_cap_enabled': bool(cfg.get('pause_cap_enabled', False)),
            'weekend_diet': bool(cfg.get('weekend_diet', False)),
            'night_includes_breaks': bool(cfg.get('night_includes_breaks', False)),
        }
        ck = _cache_key(file_content, global_flags)
        cached = _cache_get(ck)
        if cached:
            return jsonify(cached)

        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            tmp.write(file_content)
            tmp_path = tmp.name
        data = parse_ddd_auto(tmp_path)
        _flags = _get_driver_analysis_flags(data)
        result = analyze_card(data, config_loader=_load_config, night_40_check_midnight=_flags['night_40_check_midnight'], pause_cap_enabled=_flags['pause_cap_enabled'], weekend_diet=_flags['weekend_diet'], night_includes_breaks=_flags['night_includes_breaks'])
        _log_activity('analyze_upload', result.get('driver_info', {}).get('driver_name', ''))
        di = result.get('driver_info', {})
        _cache_card_expiry(di.get('card_number'), di.get('card_expiry_date'), di.get('driver_name', ''))
        # Update cache key with per-driver flags
        ck_full = _cache_key(file_content, {**global_flags, **_flags})
        _cache_set(ck_full, result)
        _cache_set(ck, result)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'tmp_path' in locals():
            os.unlink(tmp_path)


@bp.route('/api/preview-ddd', methods=['POST'])
@login_required
def api_preview_ddd():
    """Return DDD file preview: hex dump + decoded card structure."""
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nie wybrano pliku'}), 400
    try:
        file_data = file.read()
        file_size = len(file_data)
        hex_dump = file_data[:8192].hex()

        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            tmp.write(file_data)
            tmp_path = tmp.name

        try:
            data = parse_ddd_auto(tmp_path, config_loader=_load_config)
        finally:
            os.unlink(tmp_path)

        card_info = get_driver_info(data)

        activity_records = []
        for rec in get_activity_records(data):
            date_str = rec.get('activity_record_date', '')
            changes = rec.get('activity_change_info', [])
            day_timeline = build_timeline([rec])
            driving_mins = sum(
                int((e - s).total_seconds()) // 60
                for s, e, wt, _co in day_timeline if wt == DRIVING
            )
            work_mins = sum(
                int((e - s).total_seconds()) // 60
                for s, e, wt, _co in day_timeline if wt == WORK
            )
            rest_mins = sum(
                int((e - s).total_seconds()) // 60
                for s, e, wt, _co in day_timeline if wt == REST
            )
            activity_records.append({
                'date': date_str[:10] if date_str else '',
                'total_activities': len(changes),
                'driving_minutes': driving_mins,
                'work_minutes': work_mins,
                'rest_minutes': rest_mins,
            })

        vehicle_records = get_vehicle_records(data)
        card_places = get_card_places(data)
        card_events = get_card_events(data)

        _log_activity('preview_ddd', card_info.get('driver_name', ''))
        return jsonify({
            'file_size': file_size,
            'hex_dump': hex_dump,
            'card_info': card_info,
            'activity_records': activity_records,
            'vehicle_records': vehicle_records,
            'card_places': card_places,
            'card_events': card_events,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/analyze/dropbox')
@login_required
def api_analyze_dropbox():
    """Download a DDD file from Dropbox and return analysis."""
    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500
    file_path = request.args.get('path')
    if not file_path:
        return jsonify({'error': 'Brak sciezki pliku'}), 400
    try:
        metadata, response = dbx.files_download(file_path)
        file_content = response.content
        cfg = _load_config()
        global_flags = {
            'night_start_hour': int(cfg.get('night_start_hour', 22)),
            'pause_cap_enabled': bool(cfg.get('pause_cap_enabled', False)),
            'weekend_diet': bool(cfg.get('weekend_diet', False)),
            'night_includes_breaks': bool(cfg.get('night_includes_breaks', False)),
        }
        ck = _cache_key(file_content, global_flags)
        cached = _cache_get(ck)
        if cached:
            cached['source_file'] = metadata.name
            return jsonify(cached)

        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            tmp.write(file_content)
            tmp_path = tmp.name
        data = parse_ddd_auto(tmp_path)
        _flags = _get_driver_analysis_flags(data)
        result = analyze_card(data, config_loader=_load_config, night_40_check_midnight=_flags['night_40_check_midnight'], pause_cap_enabled=_flags['pause_cap_enabled'], weekend_diet=_flags['weekend_diet'], night_includes_breaks=_flags['night_includes_breaks'])
        result['source_file'] = metadata.name
        _log_activity('analyze_dropbox', f"{result.get('driver_info', {}).get('driver_name', '')} — {metadata.name}")
        di = result.get('driver_info', {})
        _cache_card_expiry(di.get('card_number'), di.get('card_expiry_date'), di.get('driver_name', ''))
        ck_full = _cache_key(file_content, {**global_flags, **_flags})
        _cache_set(ck_full, result)
        _cache_set(ck, result)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'tmp_path' in locals():
            os.unlink(tmp_path)


@bp.route('/api/compare', methods=['POST'])
@login_required
def api_compare_drivers():
    """Compare shifts across multiple drivers."""
    payload = request.get_json(silent=True) or {}
    files = payload.get('files', [])
    if not files or not isinstance(files, list):
        return jsonify({'error': 'files list required'}), 400
    if len(files) > 20:
        return jsonify({'error': 'Max 20 drivers'}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    results = []
    for entry in files:
        file_path = entry.get('path', '')
        driver_name = entry.get('driver_name', '')
        card_number = entry.get('card_number', '')
        if not file_path:
            continue
        try:
            metadata, response = dbx.files_download(file_path)
            with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
                tmp.write(response.content)
                tmp_path = tmp.name
            data = parse_ddd_auto(tmp_path, config_loader=_load_config)
            _flags = _get_driver_analysis_flags(data)
            analysis = analyze_card(data, config_loader=_load_config, night_40_check_midnight=_flags['night_40_check_midnight'], pause_cap_enabled=_flags['pause_cap_enabled'], weekend_diet=_flags['weekend_diet'], night_includes_breaks=_flags['night_includes_breaks'])
            os.unlink(tmp_path)

            shifts = []
            for sh in analysis.get('shift_details', []):
                shifts.append({
                    'date': sh.get('shift_date', ''),
                    'weekday': sh.get('weekday', ''),
                    'start': sh.get('shift_start', ''),
                    'end': sh.get('shift_end', ''),
                    'duration_hm': sh.get('duration_hm', ''),
                    'work_minutes': sh.get('work_minutes', 0),
                })

            results.append({
                'driver_name': driver_name or analysis.get('driver_info', {}).get('driver_name', ''),
                'card_number': card_number,
                'shifts': shifts,
            })
        except Exception:
            results.append({
                'driver_name': driver_name,
                'card_number': card_number,
                'shifts': [],
                'error': 'Nie udalo sie przeanalizowac pliku',
            })

    _log_activity('compare_drivers', f"{len(results)} drivers")
    return jsonify({'drivers': results})
