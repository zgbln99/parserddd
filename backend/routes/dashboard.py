"""
Dashboard Blueprint — summary and card expiry scanning.
"""

import json
import os
import tempfile
from datetime import datetime

from flask import Blueprint, jsonify

from auth.decorators import login_required
from auth.helpers import _get_db
from core.constants import UTC
from core.parsers import parse_ddd_auto
from core.extractors import get_driver_info
from auth.helpers import _load_config
from services.dropbox_service import (
    get_server_dropbox_client, load_portal_cache,
)

bp = Blueprint('dashboard', __name__)


def _cache_card_expiry(card_number, card_expiry_date, driver_name=''):
    if not card_number or not card_expiry_date:
        return
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


@bp.route('/api/dashboard')
@login_required
def api_dashboard():
    """Aggregate summary for the dashboard."""
    cached = load_portal_cache()
    driver_count = len(cached) if cached else 0
    total_files = sum(d.get('file_count', 0) for d in cached) if cached else 0

    state_file = os.environ.get('SYNC_STATE_FILE', '/opt/ddd-reader/samsara_sync_state.json')
    last_sync = ''
    synced_count = 0
    try:
        if os.path.exists(state_file):
            with open(state_file) as f:
                data = json.load(f)
            last_sync = data.get('last_sync', '')
            synced_count = len(data.get('synced_ids', []))
    except Exception:
        pass

    history_file = os.environ.get('SYNC_HISTORY_FILE', '/opt/ddd-reader/samsara_sync_history.json')
    last_sync_status = ''
    last_sync_errors = 0
    last_sync_uploaded = 0
    try:
        if os.path.exists(history_file):
            with open(history_file) as f:
                history = json.load(f)
            if history:
                last = history[-1]
                last_sync_status = last.get('status', '')
                last_sync_errors = last.get('errors', 0)
                last_sync_uploaded = last.get('uploaded', 0)
    except Exception:
        pass

    stale_drivers = []
    if cached:
        now = datetime.utcnow()
        for d in cached:
            ld = d.get('latest_download', '')
            days = None
            if ld:
                try:
                    cleaned = ld.replace('Z', '+00:00') if ld.endswith('Z') else ld
                    dt = datetime.fromisoformat(cleaned.replace('+00:00', ''))
                    days = (now - dt).days
                except Exception:
                    pass
            stale_drivers.append({
                'name': d.get('name', ''),
                'card_number': d.get('card_number', ''),
                'days_since': days,
                'latest_download': ld,
                'file_count': d.get('file_count', 0),
                'latest_file_path': d.get('files', [{}])[0].get('path', '') if d.get('files') else '',
                'latest_file_name': d.get('files', [{}])[0].get('name', '') if d.get('files') else '',
            })
        stale_drivers.sort(key=lambda x: (0 if x['days_since'] is None else 1, -(x['days_since'] or 9999)))

    expiring_cards = []
    try:
        conn = _get_db()
        rows = conn.execute(
            "SELECT card_number, driver_name, card_expiry_date FROM driver_config WHERE card_expiry_date != ''"
        ).fetchall()
        conn.close()
        today = datetime.utcnow().date()
        for row in rows:
            try:
                expiry = datetime.strptime(row[2], '%Y-%m-%d').date() if row[2] else None
                if expiry:
                    days_left = (expiry - today).days
                    expiring_cards.append({
                        'card_number': row[0],
                        'driver_name': row[1],
                        'card_expiry_date': row[2],
                        'days_left': days_left,
                    })
            except Exception:
                pass
        expiring_cards.sort(key=lambda x: x['days_left'])
    except Exception:
        pass

    return jsonify({
        'driver_count': driver_count,
        'total_files': total_files,
        'last_sync': last_sync,
        'synced_count': synced_count,
        'last_sync_status': last_sync_status,
        'last_sync_errors': last_sync_errors,
        'last_sync_uploaded': last_sync_uploaded,
        'stale_drivers': stale_drivers,
        'expiring_cards': expiring_cards,
    })


@bp.route('/api/dashboard/scan-expiry', methods=['POST'])
@login_required
def api_scan_card_expiry():
    """Bulk scan all drivers' latest DDD files to cache card expiry dates."""
    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    cached = load_portal_cache()
    if not cached:
        return jsonify({'error': 'Brak danych kierowcow'}), 400

    results = []
    for driver in cached:
        files = driver.get('files', [])
        if not files:
            continue
        latest = files[0]
        fpath = latest.get('path', '')
        if not fpath:
            continue
        try:
            _, response = dbx.files_download(fpath)
            with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
                tmp.write(response.content)
                tmp_path = tmp.name
            data = parse_ddd_auto(tmp_path, config_loader=_load_config)
            info = get_driver_info(data)
            os.unlink(tmp_path)
            if info.get('card_number') and info.get('card_expiry_date'):
                _cache_card_expiry(info['card_number'], info['card_expiry_date'], info.get('driver_name', ''))
                results.append({
                    'driver': driver.get('name', ''),
                    'card_number': info['card_number'],
                    'card_expiry_date': info['card_expiry_date'],
                })
        except Exception:
            if 'tmp_path' in locals():
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
            continue

    return jsonify({'scanned': len(results), 'results': results})
