"""Storage integration — client factory, driver listing, portal cache.

Historically backed by Dropbox; now backed by MEGA S4 (S3-compatible) via
:mod:`services.storage_service`. The function names are kept so existing
call sites don't change: ``get_server_dropbox_client`` returns a storage
client whose method names mirror the old Dropbox SDK.
"""

import json
import os
import re
from datetime import datetime

from config import PORTAL_CACHE_FILE, PORTAL_CACHE_MAX_AGE
from core.constants import UTC
from services import storage_service


def get_server_dropbox_client():
    """Return the server-side storage client (or None when not configured)."""
    return storage_service.get_client()


def build_drivers_data(dbx, sync_folder):
    """Build the driver list from the storage folder structure.

    Layout: ``{sync_folder}/{driver_name}/{filename}``. Object storage has
    no real folders, so drivers are derived from the file keys themselves.
    """
    result = dbx.files_list_folder(sync_folder, recursive=True)
    all_entries = list(result.entries)
    while getattr(result, 'has_more', False):
        result = dbx.files_list_folder_continue(result.cursor)
        all_entries.extend(result.entries)

    base = sync_folder.rstrip('/')
    driver_files: dict[str, list] = {}
    driver_paths: dict[str, str] = {}

    for entry in all_entries:
        if not getattr(entry, 'is_file', True):
            continue
        path_display = entry.path_display
        rel = (path_display[len(base):] if path_display.startswith(base) else path_display).strip('/')
        parts = rel.split('/')
        if len(parts) != 2:
            continue
        driver_name, fname = parts
        driver_paths.setdefault(driver_name, f'{base}/{driver_name}')
        driver_files.setdefault(driver_name, [])

        card_number = ''
        file_date = ''
        m = re.match(r'^(.+?)_(\d{4}-\d{2}-\d{2})\.ddd$', fname, re.IGNORECASE)
        if m:
            card_number = m.group(1)
            file_date = m.group(2)

        modified = ''
        sm = getattr(entry, 'server_modified', None)
        if sm:
            try:
                # Normalize to UTC with 'Z' suffix so the string survives URL
                # round-trips (the '+' in '+00:00' gets eaten by URLSearchParams).
                if getattr(sm, 'tzinfo', None) is not None:
                    sm = sm.astimezone(UTC)
                modified = sm.strftime('%Y-%m-%dT%H:%M:%SZ')
            except Exception:
                modified = str(sm)

        driver_files[driver_name].append({
            'name': fname,
            'path': path_display,
            'size': getattr(entry, 'size', 0),
            'modified': modified,
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
            'path': driver_paths.get(driver_name, f'{base}/{driver_name}'),
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
