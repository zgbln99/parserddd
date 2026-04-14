"""
Sync Blueprint — Samsara sync status, log, and live tachograph data.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import requests as http_requests
from flask import Blueprint, jsonify

from auth.decorators import login_required
from auth.helpers import _load_config

bp = Blueprint('sync', __name__)

SAMSARA_API_BASE = 'https://api.eu.samsara.com'


def _get_samsara_token():
    cfg = _load_config()
    return cfg.get('samsara_api_token') or os.environ.get('SAMSARA_API_TOKEN', '')


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


@bp.route('/api/samsara/live-status')
@login_required
def api_samsara_live_status():
    """Get live HOS/tachograph status for all drivers from Samsara."""
    token = _get_samsara_token()
    if not token:
        return jsonify({'error': 'Samsara API token not configured'}), 500

    now = datetime.now(timezone.utc)
    headers = {'Authorization': f'Bearer {token}'}

    try:
        all_data = []
        has_next = True
        after = None

        while has_next:
            params = {}
            if after:
                params['after'] = after
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/hos/clocks',
                headers=headers, params=params, timeout=15,
            )
            if resp.status_code != 200:
                return jsonify({'error': f'Samsara API: {resp.status_code}'}), 502

            body = resp.json()
            all_data.extend(body.get('data', []))
            pagination = body.get('pagination', {})
            after = pagination.get('endCursor')
            has_next = pagination.get('hasNextPage', False)

        drivers = []
        for entry in all_data:
            driver = entry.get('driver', {})
            vehicle = entry.get('currentVehicle', {})
            duty = entry.get('currentDutyStatus', {})
            clocks = entry.get('clocks', {})

            hos_status = duty.get('hosStatusType', '')
            status_map = {
                'driving': 'driving',
                'onDuty': 'work',
                'onDutyNotDriving': 'work',
                'sleeper': 'rest',
                'offDuty': 'rest',
            }
            status = status_map.get(hos_status, hos_status)

            # Calculate remaining times
            drive_remaining = clocks.get('drive', {}).get('driveRemainingDurationMs', 0)
            shift_remaining = clocks.get('shift', {}).get('shiftRemainingDurationMs', 0)
            break_time = clocks.get('break', {}).get('timeUntilBreakDurationMs', 0)

            drivers.append({
                'id': driver.get('id', ''),
                'name': driver.get('name', ''),
                'status': status,
                'hos_status': hos_status,
                'vehicle': vehicle.get('name', ''),
                'drive_remaining_min': max(0, drive_remaining // 60000),
                'shift_remaining_min': max(0, shift_remaining // 60000),
                'break_in_min': max(0, break_time // 60000),
            })

        drivers.sort(key=lambda d: d['name'])
        return jsonify({'drivers': drivers, 'timestamp': now.isoformat()})

    except http_requests.Timeout:
        return jsonify({'error': 'Samsara API timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500
