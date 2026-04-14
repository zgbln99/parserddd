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
        # 1. Fetch ALL drivers
        all_drivers = []
        has_next = True
        after = None
        while has_next:
            params = {}
            if after:
                params['after'] = after
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/drivers',
                headers=headers, params=params, timeout=15,
            )
            if resp.status_code != 200:
                break
            body = resp.json()
            all_drivers.extend(body.get('data', []))
            pagination = body.get('pagination', {})
            after = pagination.get('endCursor')
            has_next = pagination.get('hasNextPage', False)

        # 2. Fetch HOS clocks (active sessions only)
        hos_data = []
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
                break
            body = resp.json()
            hos_data.extend(body.get('data', []))
            pagination = body.get('pagination', {})
            after = pagination.get('endCursor')
            has_next = pagination.get('hasNextPage', False)

        # 3. Build HOS lookup by driver ID
        hos_by_id = {}
        for entry in hos_data:
            driver = entry.get('driver', {})
            driver_id = driver.get('id', '')
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

            drive_remaining = clocks.get('drive', {}).get('driveRemainingDurationMs', 0)
            shift_remaining = clocks.get('shift', {}).get('shiftRemainingDurationMs', 0)
            break_time = clocks.get('break', {}).get('timeUntilBreakDurationMs', 0)

            hos_by_id[driver_id] = {
                'status': status_map.get(hos_status, hos_status),
                'hos_status': hos_status,
                'vehicle': vehicle.get('name', ''),
                'drive_remaining_min': max(0, drive_remaining // 60000),
                'shift_remaining_min': max(0, shift_remaining // 60000),
                'break_in_min': max(0, break_time // 60000),
            }

        # 4. Merge: all drivers + HOS data
        drivers = []
        for drv in all_drivers:
            drv_id = drv.get('id', '')
            drv_name = drv.get('name', '')
            activation = drv.get('driverActivationStatus', '')
            if activation == 'deactivated':
                continue

            hos = hos_by_id.get(drv_id)
            if hos:
                drivers.append({
                    'id': drv_id,
                    'name': drv_name,
                    **hos,
                })
            else:
                drivers.append({
                    'id': drv_id,
                    'name': drv_name,
                    'status': 'unknown',
                    'hos_status': '',
                    'vehicle': '',
                    'drive_remaining_min': 0,
                    'shift_remaining_min': 0,
                    'break_in_min': 0,
                })

        drivers.sort(key=lambda d: d['name'])
        return jsonify({'drivers': drivers, 'timestamp': now.isoformat()})

    except http_requests.Timeout:
        return jsonify({'error': 'Samsara API timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500
