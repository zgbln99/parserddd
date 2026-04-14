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
    """Get live tachograph status for all drivers from Samsara."""
    token = _get_samsara_token()
    if not token:
        return jsonify({'error': 'Samsara API token not configured'}), 500

    now = datetime.now(timezone.utc)
    start = (now - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
    end = now.strftime('%Y-%m-%dT%H:%M:%SZ')

    headers = {'Authorization': f'Bearer {token}'}

    try:
        all_data = []
        has_next = True
        after = None

        while has_next:
            params = {'startTime': start, 'endTime': end}
            if after:
                params['after'] = after
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/drivers/tachograph-activity',
                headers=headers, params=params, timeout=15,
            )
            if resp.status_code != 200:
                return jsonify({'error': f'Samsara API: {resp.status_code}'}), 502

            body = resp.json()
            all_data.extend(body.get('data', []))
            pagination = body.get('pagination', {})
            after = pagination.get('endCursor')
            has_next = pagination.get('hasNextPage', False)

        # Build per-driver status from latest activity
        drivers = {}
        for entry in all_data:
            driver = entry.get('driver', {})
            driver_id = driver.get('id', '')
            driver_name = driver.get('name', '')

            activities = entry.get('tachographActivities', entry.get('activities', []))
            if not activities:
                continue

            activities.sort(key=lambda a: a.get('startTime', ''), reverse=True)
            latest = activities[0]

            activity_type = latest.get('activity', latest.get('type', '')).lower()
            start_time = latest.get('startTime', '')
            duration_sec = 0
            if start_time:
                try:
                    st = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    duration_sec = int((now - st).total_seconds())
                except Exception:
                    pass

            status_map = {
                'driving': 'driving', 'drive': 'driving',
                'work': 'work', 'working': 'work',
                'available': 'available', 'availability': 'available',
                'break': 'rest', 'rest': 'rest', 'break_rest': 'rest', 'break/rest': 'rest',
            }
            status = status_map.get(activity_type, activity_type)

            drivers[driver_id] = {
                'id': driver_id,
                'name': driver_name,
                'status': status,
                'since': start_time,
                'duration_minutes': max(0, duration_sec // 60),
            }

        result = sorted(drivers.values(), key=lambda d: d['name'])
        return jsonify({'drivers': result, 'timestamp': now.isoformat()})

    except http_requests.Timeout:
        return jsonify({'error': 'Samsara API timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500
