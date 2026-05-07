"""
TollCollect Blueprint — Dropbox file storage for toll CSV files.
"""

import re

import dropbox
from flask import Blueprint, request, jsonify

from auth.decorators import login_required
from auth.helpers import _log_activity
from config import TOLLCOLLECT_FOLDER
from services.dropbox_service import get_server_dropbox_client

bp = Blueprint('tollcollect', __name__)


@bp.route('/api/tollcollect/files')
@login_required
def api_tollcollect_files():
    """List CSV files stored in the TollCollect Dropbox folder."""
    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    try:
        result = dbx.files_list_folder(TOLLCOLLECT_FOLDER)
        entries = list(result.entries)
        while result.has_more:
            result = dbx.files_list_folder_continue(result.cursor)
            entries.extend(result.entries)
    except dropbox.exceptions.ApiError as e:
        if 'not_found' in str(e):
            return jsonify({'files': []})
        return jsonify({'error': str(e)}), 500

    files = []
    for entry in entries:
        if not isinstance(entry, dropbox.files.FileMetadata):
            continue
        files.append({
            'name': entry.name,
            'path': entry.path_display,
            'size': entry.size,
            'modified': entry.server_modified.isoformat() if entry.server_modified else '',
        })

    files.sort(key=lambda f: f['modified'], reverse=True)
    return jsonify({'files': files})


@bp.route('/api/tollcollect/upload', methods=['POST'])
@login_required
def api_tollcollect_upload():
    """Upload a Toll Collect CSV to the Dropbox TollCollect folder."""
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400

    file = request.files['file']
    period = request.form.get('period', '').strip()

    if period and re.match(r'^\d{4}-\d{2}$', period):
        safe_name = f"{period} Maut LTS Logistik GmbH.csv"
    else:
        fname = file.filename or 'tollcollect.csv'
        safe_name = "".join(c for c in fname if c.isalnum() or c in '._- ').strip() or 'tollcollect.csv'

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    dbx_path = f"{TOLLCOLLECT_FOLDER}/{safe_name}"
    try:
        file_data = file.read()
        dbx.files_upload(
            file_data,
            dbx_path,
            mode=dropbox.files.WriteMode.overwrite,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    _log_activity('tollcollect_upload', safe_name)
    return jsonify({'ok': True, 'path': dbx_path, 'filename': safe_name})


@bp.route('/api/tollcollect/download')
@login_required
def api_tollcollect_download():
    """Download a Toll Collect CSV from Dropbox."""
    path = request.args.get('path', '').strip()
    if not path:
        return jsonify({'error': 'Brak parametru path'}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    try:
        metadata, response = dbx.files_download(path)
        content = response.content.decode('utf-8', errors='replace')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    return jsonify({
        'ok': True,
        'filename': metadata.name,
        'content': content,
    })


@bp.route('/api/tollcollect/delete', methods=['POST'])
@login_required
def api_tollcollect_delete():
    """Delete a Toll Collect file from Dropbox."""
    data = request.get_json(silent=True) or {}
    path = data.get('path', '').strip()
    if not path:
        return jsonify({'error': 'Brak parametru path'}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    try:
        dbx.files_delete_v2(path)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    _log_activity('tollcollect_delete', path)
    return jsonify({'ok': True})
