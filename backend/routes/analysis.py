"""
Analysis Blueprint — file upload analysis, preview, Dropbox analysis, compare.
"""

import os
import tempfile

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


def _get_night_40_enabled(data):
    """Look up night_40_enabled from driver_config for the card in parsed data."""
    try:
        di = get_driver_info(data)
        card_number = di.get('card_number', '')
        if not card_number:
            return True
        conn = _get_db()
        row = conn.execute('SELECT night_40_enabled FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()
        conn.close()
        if row:
            return bool(row['night_40_enabled'])
    except Exception:
        pass
    return True


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
        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name
        data = parse_ddd_auto(tmp_path, config_loader=_load_config)
        n40 = _get_night_40_enabled(data)
        result = analyze_card(data, config_loader=_load_config, night_40_check_midnight=n40)
        _log_activity('analyze_upload', result.get('driver_info', {}).get('driver_name', ''))
        di = result.get('driver_info', {})
        _cache_card_expiry(di.get('card_number'), di.get('card_expiry_date'), di.get('driver_name', ''))
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
        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name
        data = parse_ddd_auto(tmp_path, config_loader=_load_config)
        n40 = _get_night_40_enabled(data)
        result = analyze_card(data, config_loader=_load_config, night_40_check_midnight=n40)
        result['source_file'] = metadata.name
        _log_activity('analyze_dropbox', f"{result.get('driver_info', {}).get('driver_name', '')} — {metadata.name}")
        di = result.get('driver_info', {})
        _cache_card_expiry(di.get('card_number'), di.get('card_expiry_date'), di.get('driver_name', ''))
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
            n40 = _get_night_40_enabled(data)
            analysis = analyze_card(data, config_loader=_load_config, night_40_check_midnight=n40)
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
