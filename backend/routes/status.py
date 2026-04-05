"""
Status Blueprint — connection health checks.
"""

import requests as http_requests
from flask import Blueprint, jsonify

from auth.decorators import login_required
from config import SAMSARA_API_TOKEN, SAMSARA_API_BASE
from services.dropbox_service import get_server_dropbox_client

bp = Blueprint('status', __name__)


@bp.route('/api/status/connections')
@login_required
def api_connection_status():
    """Check Dropbox and Samsara connectivity."""
    result = {'dropbox': False, 'samsara': False}

    dbx = get_server_dropbox_client()
    if dbx:
        try:
            dbx.users_get_current_account()
            result['dropbox'] = True
        except Exception:
            pass

    if SAMSARA_API_TOKEN:
        try:
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/drivers',
                headers={'Authorization': f'Bearer {SAMSARA_API_TOKEN}'},
                params={'limit': 1},
                timeout=5,
            )
            result['samsara'] = resp.status_code == 200
        except Exception:
            pass

    return jsonify(result)
