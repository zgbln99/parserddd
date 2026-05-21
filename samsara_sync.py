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
    SAMSARA_API_TOKEN       - Samsara API token (required)
    DROPBOX_REFRESH_TOKEN   - Dropbox refresh token (required, long-lived)
    DROPBOX_APP_KEY         - Dropbox app key (default: j9ntkihedd9495i)
    DROPBOX_APP_SECRET      - Dropbox app secret (default: d3hr43reha9kky8)
    SYNC_STATE_FILE         - Path to state file (default: /opt/ddd-reader/samsara_sync_state.json)
    SYNC_DEST_FOLDER        - Dropbox destination folder (default: /Samsara-DDD)
    SYNC_DAYS_BACK          - How many days back to check (default: 30)
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

SAMSARA_API_TOKEN = os.environ.get('SAMSARA_API_TOKEN', '')
SAMSARA_API_BASE = 'https://api.eu.samsara.com'
MEGA_S4_ACCESS_KEY_ID = os.environ.get('MEGA_S4_ACCESS_KEY_ID', '')
MEGA_S4_SECRET_ACCESS_KEY = os.environ.get('MEGA_S4_SECRET_ACCESS_KEY', '')
MEGA_S4_BUCKET = os.environ.get('MEGA_S4_BUCKET', '')
MEGA_S4_ENDPOINT = os.environ.get('MEGA_S4_ENDPOINT', 'https://s3.g.s4.mega.io')
MEGA_S4_REGION = os.environ.get('MEGA_S4_REGION', 'eu-central-1')
STATE_FILE = os.environ.get('SYNC_STATE_FILE', '/opt/ddd-reader/samsara_sync_state.json')
SYNC_HISTORY_FILE = os.environ.get('SYNC_HISTORY_FILE', '/opt/ddd-reader/samsara_sync_history.json')
DEST_FOLDER = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
DAYS_BACK = int(os.environ.get('SYNC_DAYS_BACK', '30'))
MAX_HISTORY_ENTRIES = 100


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
            'last_sync': datetime.now(tz=timezone.utc).isoformat() + 'Z',
        }, f, indent=2)


def save_sync_history(entry):
    """Append a sync run entry to history file (keep last MAX_HISTORY_ENTRIES)."""
    history = []
    if os.path.exists(SYNC_HISTORY_FILE):
        try:
            with open(SYNC_HISTORY_FILE) as f:
                history = json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    history.append(entry)
    history = history[-MAX_HISTORY_ENTRIES:]
    with open(SYNC_HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2)


def fetch_samsara_files():
    """Fetch all tachograph files from Samsara API."""
    headers = {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}
    now = datetime.now(tz=timezone.utc)
    end_time = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    start_time = (now - timedelta(days=DAYS_BACK)).strftime('%Y-%m-%dT%H:%M:%SZ')

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


def upload_to_storage(s3, content, path):
    """Upload file content to the MEGA S4 bucket (overwrites)."""
    s3.put_object(Bucket=MEGA_S4_BUCKET, Key=path.lstrip('/'), Body=content)


def main():
    if not SAMSARA_API_TOKEN:
        log('ERROR: SAMSARA_API_TOKEN not set')
        sys.exit(1)
    if not (MEGA_S4_ACCESS_KEY_ID and MEGA_S4_SECRET_ACCESS_KEY and MEGA_S4_BUCKET):
        log('ERROR: MEGA S4 storage not configured')
        sys.exit(1)

    log(f'Starting sync (last {DAYS_BACK} days)...')

    # Load state
    synced_ids = load_state()
    log(f'Already synced: {len(synced_ids)} files')

    # Fetch from Samsara
    data = fetch_samsara_files()
    if data is None:
        save_sync_history({
            'timestamp': datetime.now(tz=timezone.utc).isoformat() + 'Z',
            'status': 'error',
            'error': 'Samsara API error',
            'found': 0,
            'uploaded': 0,
            'errors': 0,
            'files': [],
        })
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
        save_sync_history({
            'timestamp': datetime.now(tz=timezone.utc).isoformat() + 'Z',
            'status': 'ok',
            'found': 0,
            'uploaded': 0,
            'errors': 0,
            'files': [],
        })
        return

    log(f'Found {len(new_files)} new files to sync.')

    # Connect to MEGA S4 (S3-compatible) using credentials from the env
    try:
        import boto3
        from botocore.config import Config
        s3 = boto3.client(
            's3',
            endpoint_url=MEGA_S4_ENDPOINT,
            region_name=MEGA_S4_REGION,
            aws_access_key_id=MEGA_S4_ACCESS_KEY_ID,
            aws_secret_access_key=MEGA_S4_SECRET_ACCESS_KEY,
            config=Config(signature_version='s3v4', s3={'addressing_style': 'path'}),
        )
        s3.head_bucket(Bucket=MEGA_S4_BUCKET)
        log(f'MEGA S4 connected: bucket {MEGA_S4_BUCKET}')
    except Exception as e:
        log(f'ERROR: MEGA S4 connection failed: {e}')
        save_sync_history({
            'timestamp': datetime.now(tz=timezone.utc).isoformat() + 'Z',
            'status': 'error',
            'error': f'Dropbox connection failed: {e}',
            'found': len(new_files),
            'uploaded': 0,
            'errors': 0,
            'files': [],
        })
        sys.exit(1)

    # Download and upload each file
    uploaded = 0
    errors = 0
    uploaded_files = []
    for f in new_files:
        url = f['url']
        if not url:
            continue

        driver_name = f['driver_name']
        safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'kierowca'
        date_part = f['created_at'][:10] if f['created_at'] else datetime.now(tz=timezone.utc).strftime('%Y-%m-%d')
        card = f['card_number']
        fname = f"{card}_{date_part}.ddd" if card else f"{safe_name}_{date_part}.ddd"
        dbx_path = f"{DEST_FOLDER}/{safe_name}/{fname}"

        try:
            resp = requests.get(url, timeout=60)
            if resp.status_code != 200:
                log(f'  SKIP {fname}: HTTP {resp.status_code}')
                errors += 1
                uploaded_files.append({
                    'driver': driver_name,
                    'file': fname,
                    'path': dbx_path,
                    'status': 'error',
                    'error': f'HTTP {resp.status_code}',
                })
                continue

            upload_to_storage(s3, resp.content, dbx_path)
            synced_ids.add(f['id'])
            uploaded += 1
            log(f'  OK {dbx_path} ({len(resp.content)} bytes)')
            uploaded_files.append({
                'driver': driver_name,
                'file': fname,
                'path': dbx_path,
                'size': len(resp.content),
                'status': 'ok',
            })

        except Exception as e:
            log(f'  ERROR {fname}: {e}')
            errors += 1
            uploaded_files.append({
                'driver': driver_name,
                'file': fname,
                'path': dbx_path,
                'status': 'error',
                'error': str(e),
            })

    # Save state
    save_state(synced_ids)

    # Save sync history
    save_sync_history({
        'timestamp': datetime.now(tz=timezone.utc).isoformat() + 'Z',
        'status': 'ok' if errors == 0 else 'partial',
        'found': len(new_files),
        'uploaded': uploaded,
        'errors': errors,
        'files': uploaded_files,
    })

    # Invalidate portal cache so next page load fetches fresh data
    cache_file = os.environ.get('PORTAL_CACHE_FILE', '/opt/ddd-reader/portal_cache.json')
    try:
        if os.path.exists(cache_file):
            os.remove(cache_file)
            log('Portal cache invalidated.')
    except Exception:
        pass

    # Pre-warm analysis cache for uploaded files
    app_url = os.environ.get('APP_URL', 'http://127.0.0.1:5000')
    admin_pw = os.environ.get('ADMIN_PASSWORD', '')
    if uploaded_files and admin_pw:
        log(f'Pre-warming analysis cache for {len(uploaded_files)} files...')
        try:
            session = requests.Session()
            session.post(f'{app_url}/api/auth/login', json={'password': admin_pw}, timeout=5)
            warmed = 0
            for f in uploaded_files:
                if f.get('status') != 'ok':
                    continue
                try:
                    session.get(f'{app_url}/api/analyze/dropbox', params={'path': f['path']}, timeout=30)
                    warmed += 1
                except Exception:
                    pass
            log(f'Pre-warmed {warmed} analyses.')
        except Exception as exc:
            log(f'Pre-warm failed: {exc}')

    log(f'Done: {uploaded} uploaded, {errors} errors, {len(synced_ids)} total synced.')


if __name__ == '__main__':
    main()
