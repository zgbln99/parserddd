#!/usr/bin/env python3
"""
Samsara -> Dropbox automatic sync script.

Periodically checks Samsara for new tachograph (.ddd) files
and uploads them to Dropbox, organized by driver name.

Usage:
    # Single run:
    python3 samsara_sync.py

    # Cron (every hour):
    0 * * * * cd /opt/ddd-reader && ./venv/bin/python3 samsara_sync.py >> /var/log/samsara-sync.log 2>&1

Environment variables:
    SAMSARA_API_TOKEN   - Samsara API token (required)
    DROPBOX_TOKEN       - Dropbox access token (required)
    SYNC_STATE_FILE     - Path to state file (default: /opt/ddd-reader/samsara_sync_state.json)
    SYNC_DEST_FOLDER    - Dropbox destination folder (default: /Samsara-DDD)
    SYNC_DAYS_BACK      - How many days back to check (default: 30)
"""

import json
import os
import sys
from datetime import datetime, timedelta

import dropbox
import requests

SAMSARA_API_TOKEN = os.environ.get('SAMSARA_API_TOKEN', '')
SAMSARA_API_BASE = 'https://api.eu.samsara.com'
DROPBOX_TOKEN = os.environ.get('DROPBOX_TOKEN', '')
STATE_FILE = os.environ.get('SYNC_STATE_FILE', '/opt/ddd-reader/samsara_sync_state.json')
DEST_FOLDER = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
DAYS_BACK = int(os.environ.get('SYNC_DAYS_BACK', '30'))


def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def load_state():
    """Load set of already-synced file IDs."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                data = json.load(f)
            return set(data.get('synced_ids', []))
        except (json.JSONDecodeError, IOError):
            pass
    return set()


def save_state(synced_ids):
    """Save synced file IDs to state file."""
    with open(STATE_FILE, 'w') as f:
        json.dump({
            'synced_ids': list(synced_ids),
            'last_sync': datetime.utcnow().isoformat() + 'Z',
        }, f, indent=2)


def fetch_samsara_files():
    """Fetch all tachograph files from Samsara API."""
    headers = {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}
    end_time = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    start_time = (datetime.utcnow() - timedelta(days=DAYS_BACK)).strftime('%Y-%m-%dT%H:%M:%SZ')

    all_data = []
    has_next = True
    after = None

    while has_next:
        params = {'startTime': start_time, 'endTime': end_time}
        if after:
            params['after'] = after

        resp = requests.get(
            f'{SAMSARA_API_BASE}/fleet/drivers/tachograph-files/history',
            headers=headers,
            params=params,
            timeout=30,
        )

        if resp.status_code != 200:
            log(f'ERROR: Samsara API returned {resp.status_code}: {resp.text[:200]}')
            return None

        body = resp.json()
        all_data.extend(body.get('data', []))

        pagination = body.get('pagination', {})
        after = pagination.get('endCursor')
        has_next = pagination.get('hasNextPage', False)

    return all_data


def upload_to_dropbox(dbx, content, path):
    """Upload file content to Dropbox."""
    dbx.files_upload(
        content,
        path,
        mode=dropbox.files.WriteMode.overwrite,
    )


def main():
    if not SAMSARA_API_TOKEN:
        log('ERROR: SAMSARA_API_TOKEN not set')
        sys.exit(1)
    if not DROPBOX_TOKEN:
        log('ERROR: DROPBOX_TOKEN not set')
        sys.exit(1)

    log(f'Starting sync (last {DAYS_BACK} days)...')

    # Load state
    synced_ids = load_state()
    log(f'Already synced: {len(synced_ids)} files')

    # Fetch from Samsara
    data = fetch_samsara_files()
    if data is None:
        sys.exit(1)

    # Collect new files
    new_files = []
    for entry in data:
        driver = entry.get('driver', {})
        driver_name = driver.get('name', 'Nieznany')
        files = entry.get('tachographFiles', entry.get('files', []))

        for f in files:
            file_id = f.get('id', '')
            if not file_id or file_id in synced_ids:
                continue
            new_files.append({
                'id': file_id,
                'driver_name': driver_name,
                'card_number': f.get('cardNumber', ''),
                'created_at': f.get('createdAtTime', ''),
                'url': f.get('url', ''),
            })

    if not new_files:
        log('No new files found.')
        save_state(synced_ids)
        return

    log(f'Found {len(new_files)} new files to sync.')

    # Connect to Dropbox
    try:
        dbx = dropbox.Dropbox(DROPBOX_TOKEN)
        dbx.users_get_current_account()
    except Exception as e:
        log(f'ERROR: Dropbox connection failed: {e}')
        sys.exit(1)

    # Download and upload each file
    uploaded = 0
    errors = 0
    for f in new_files:
        url = f['url']
        if not url:
            continue

        driver_name = f['driver_name']
        safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'kierowca'
        date_part = f['created_at'][:10] if f['created_at'] else datetime.utcnow().strftime('%Y-%m-%d')
        card = f['card_number']
        fname = f"{card}_{date_part}.ddd" if card else f"{safe_name}_{date_part}.ddd"
        dbx_path = f"{DEST_FOLDER}/{safe_name}/{fname}"

        try:
            resp = requests.get(url, timeout=60)
            if resp.status_code != 200:
                log(f'  SKIP {fname}: HTTP {resp.status_code}')
                errors += 1
                continue

            upload_to_dropbox(dbx, resp.content, dbx_path)
            synced_ids.add(f['id'])
            uploaded += 1
            log(f'  OK {dbx_path} ({len(resp.content)} bytes)')

        except Exception as e:
            log(f'  ERROR {fname}: {e}')
            errors += 1

    # Save state
    save_state(synced_ids)
    log(f'Done: {uploaded} uploaded, {errors} errors, {len(synced_ids)} total synced.')


if __name__ == '__main__':
    main()
