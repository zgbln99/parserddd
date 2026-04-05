"""
Sync Blueprint — Samsara sync status and log.
"""

import json
import os

from flask import Blueprint, jsonify

from auth.decorators import login_required

bp = Blueprint('sync', __name__)


@bp.route('/api/sync/status')
@login_required
def api_sync_status():
    state_file = os.environ.get('SYNC_STATE_FILE', '/opt/ddd-reader/samsara_sync_state.json')
    try:
        if os.path.exists(state_file):
            with open(state_file) as f:
                data = json.load(f)
            return jsonify({
                'last_sync': data.get('last_sync', ''),
                'synced_count': len(data.get('synced_ids', [])),
            })
        return jsonify({'last_sync': '', 'synced_count': 0})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/sync/log')
@login_required
def api_sync_log():
    history_file = os.environ.get('SYNC_HISTORY_FILE', '/opt/ddd-reader/samsara_sync_history.json')
    try:
        if os.path.exists(history_file):
            with open(history_file) as f:
                history = json.load(f)
            history.reverse()
            return jsonify({'history': history})
        return jsonify({'history': []})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
