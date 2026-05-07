"""
Dropbox integration — client factory, driver listing, portal cache.
"""

import json
import os
import re
from datetime import datetime

import dropbox

from config import (
    DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN,
    PORTAL_CACHE_FILE, PORTAL_CACHE_MAX_AGE,
)
from core.constants import UTC


def get_server_dropbox_client():
    """Get a Dropbox client using the server-side refresh token."""
    if not DROPBOX_REFRESH_TOKEN:
        return None
    try:
        return dropbox.Dropbox(
            oauth2_refresh_token=DROPBOX_REFRESH_TOKEN,
            app_key=DROPBOX_APP_KEY,
            app_secret=DROPBOX_APP_SECRET,
        )
    except Exception:
        return None


def build_drivers_data(dbx, sync_folder):
    """Build driver list with files from Dropbox folder structure."""
    result = dbx.files_list_folder(sync_folder, recursive=True)
    all_entries = list(result.entries)
    while result.has_more:
        result = dbx.files_list_folder_continue(result.cursor)
        all_entries.extend(result.entries)

    driver_files = {}
    driver_paths = {}
    for entry in all_entries:
        if isinstance(entry, dropbox.files.FolderMetadata):
            rel = entry.path_display[len(sync_folder):].strip('/')
            if '/' not in rel and rel:
                driver_paths[rel] = entry.path_display
            continue
        if not isinstance(entry, dropbox.files.FileMetadata):
            continue
        rel = entry.path_display[len(sync_folder):].strip('/')
        parts = rel.split('/')
        if len(parts) != 2:
            continue
        driver_name = parts[0]
        fname = parts[1]
        if driver_name not in driver_files:
            driver_files[driver_name] = []

        card_number = ''
        file_date = ''
        m = re.match(r'^(.+?)_(\d{4}-\d{2}-\d{2})\.ddd$', fname, re.IGNORECASE)
        if m:
            card_number = m.group(1)
            file_date = m.group(2)

        driver_files[driver_name].append({
            'name': fname,
            'path': entry.path_display,
            'size': entry.size,
            'modified': entry.server_modified.isoformat() if entry.server_modified else '',
            'card_number': card_number,
            'file_date': file_date,
        })

    drivers = []
    for driver_name in set(driver_paths.keys()) | set(driver_files.keys()):
        files = driver_files.get(driver_name, [])
        files.sort(key=lambda x: x.get('file_date', ''), reverse=True)

        earliest_date = latest_date = latest_download = card_number = ''
        if files:
            dates = [f['file_date'] for f in files if f['file_date']]
            if dates:
                earliest_date = min(dates)
                latest_date = max(dates)
            modified_dates = [f['modified'] for f in files if f['modified']]
            if modified_dates:
                latest_download = max(modified_dates)
            for f in files:
                if f['card_number']:
                    card_number = f['card_number']
                    break

        days_since = None
        if latest_download:
            try:
                last_dt = datetime.fromisoformat(latest_download)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=UTC)
                days_since = (datetime.now(UTC) - last_dt).days
            except Exception:
                pass

        drivers.append({
            'name': driver_name,
            'path': driver_paths.get(driver_name, f'{sync_folder}/{driver_name}'),
            'card_number': card_number,
            'file_count': len(files),
            'earliest_date': earliest_date,
            'latest_date': latest_date,
            'latest_download': latest_download,
            'days_since': days_since,
            'files': files,
        })

    drivers.sort(key=lambda d: d.get('latest_download', ''), reverse=True)
    return drivers


def load_portal_cache():
    """Load cached driver list from file (if fresh enough)."""
    try:
        if os.path.exists(PORTAL_CACHE_FILE):
            mtime = os.path.getmtime(PORTAL_CACHE_FILE)
            age = datetime.now().timestamp() - mtime
            if age < PORTAL_CACHE_MAX_AGE:
                with open(PORTAL_CACHE_FILE) as f:
                    return json.load(f)
    except Exception:
        pass
    return None


def save_portal_cache(drivers):
    """Save driver list to cache file."""
    try:
        with open(PORTAL_CACHE_FILE, 'w') as f:
            json.dump(drivers, f)
    except Exception:
        pass
