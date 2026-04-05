"""
Drivers Blueprint — driver listing, adding, and file upload to Dropbox.

Endpoints:
    GET  /api/drivers            — List drivers from Dropbox (cached)
    POST /api/drivers/add        — Create a new driver folder in Dropbox
    POST /api/reader/save-to-dropbox — Upload a .ddd file to driver's Dropbox folder
"""

import os
from datetime import datetime

import dropbox
from flask import Blueprint, request, jsonify

from auth.decorators import login_required
from auth.helpers import _log_activity
from config import PORTAL_CACHE_FILE
from core.constants import UTC
from services.dropbox_service import (
    get_server_dropbox_client,
    build_drivers_data,
    load_portal_cache,
    save_portal_cache,
)

bp = Blueprint('drivers', __name__)


@bp.route('/api/drivers')
@login_required
def api_drivers():
    """List drivers from Dropbox with caching."""
    force = request.args.get('refresh') == '1'
    if not force:
        cached = load_portal_cache()
        if cached is not None:
            for d in cached:
                if d.get('latest_download'):
                    try:
                        last_dt = datetime.fromisoformat(d['latest_download'])
                        if last_dt.tzinfo is None:
                            last_dt = last_dt.replace(tzinfo=UTC)
                        d['days_since'] = (datetime.now(UTC) - last_dt).days
                    except Exception:
                        pass
            return jsonify({'drivers': cached, 'cached': True})

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox (brak DROPBOX_REFRESH_TOKEN)'}), 500

    sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
    try:
        drivers = build_drivers_data(dbx, sync_folder)
        save_portal_cache(drivers)
        return jsonify({'drivers': drivers})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/drivers/add', methods=['POST'])
@login_required
def api_add_driver():
    """Create a new driver folder in Dropbox."""
    payload = request.get_json(silent=True) or {}
    driver_name = (payload.get('name') or '').strip()
    if not driver_name:
        return jsonify({'error': 'Brak nazwy kierowcy'}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
    folder_path = f"{sync_folder}/{driver_name}"

    try:
        dbx.files_create_folder_v2(folder_path)
    except dropbox.exceptions.ApiError as e:
        if 'conflict' in str(e).lower() or 'path/conflict' in str(e).lower():
            return jsonify({'error': 'Folder juz istnieje'}), 409
        return jsonify({'error': str(e)}), 500

    # Invalidate cache
    try:
        if os.path.exists(PORTAL_CACHE_FILE):
            os.unlink(PORTAL_CACHE_FILE)
    except Exception:
        pass

    _log_activity('add_driver', driver_name)
    return jsonify({'ok': True, 'path': folder_path})


@bp.route('/api/reader/save-to-dropbox', methods=['POST'])
@login_required
def api_reader_save_to_dropbox():
    """Upload a .ddd file from the reader to the driver's Dropbox folder."""
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400

    file = request.files['file']
    driver_name = request.form.get('driver_name', '').strip()
    card_number = request.form.get('card_number', '').strip()

    if not driver_name:
        return jsonify({'error': 'Brak nazwy kierowcy'}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
    date_part = datetime.now().strftime('%Y-%m-%d')

    if card_number:
        fname = f"{card_number}_{date_part}.ddd"
    else:
        safe = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'file'
        fname = f"{safe}_{date_part}.ddd"

    dbx_path = f"{sync_folder}/{driver_name}/{fname}"

    try:
        file_data = file.read()
        dbx.files_upload(
            file_data,
            dbx_path,
            mode=dropbox.files.WriteMode.overwrite,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    # Invalidate cache
    try:
        if os.path.exists(PORTAL_CACHE_FILE):
            os.unlink(PORTAL_CACHE_FILE)
    except Exception:
        pass

    _log_activity('reader_save_to_dropbox', f"{driver_name} — {fname}")
    return jsonify({'ok': True, 'path': dbx_path, 'filename': fname})
