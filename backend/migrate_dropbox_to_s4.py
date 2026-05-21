#!/usr/bin/env python3
"""One-shot migration: copy files from the old Dropbox into MEGA S4.

Reuses the app's existing Dropbox credentials (refresh token + app
key/secret from the env) on the read side, and the new storage_service on
the write side, so object keys keep the exact same paths (minus the
leading slash).

Usage (on the server, in the venv):

    pip install dropbox            # the SDK was removed from requirements
    export DROPBOX_REFRESH_TOKEN=...   # if not already in env / .env
    cd backend
    python migrate_dropbox_to_s4.py                # default folders
    python migrate_dropbox_to_s4.py /Samsara-DDD   # specific folder(s)
    python migrate_dropbox_to_s4.py --dry-run      # list only, no upload

MEGA_S4_* must be configured (the app's storage). Safe to re-run — it
overwrites objects with identical content.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from services import storage_service as st  # noqa: E402

DEFAULT_FOLDERS = [
    os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD'),
    '/TollCollect',
    os.environ.get('SIGNED_PDF_FOLDER', os.environ.get('DROPBOX_SIGNED_FOLDER', '/Verstoesse-Unterschriften')),
]


def _dropbox_client():
    try:
        import dropbox
    except ImportError:
        print('ERROR: dropbox SDK not installed — run:  pip install dropbox')
        sys.exit(1)
    token = os.environ.get('DROPBOX_REFRESH_TOKEN', '')
    app_key = os.environ.get('DROPBOX_APP_KEY', '') or 'j9ntkihedd9495i'
    app_secret = os.environ.get('DROPBOX_APP_SECRET', '') or 'd3hr43reha9kky8'
    if not token:
        print('ERROR: DROPBOX_REFRESH_TOKEN not set (export it or put it in .env)')
        sys.exit(1)
    dbx = dropbox.Dropbox(
        oauth2_refresh_token=token, app_key=app_key, app_secret=app_secret,
    )
    acct = dbx.users_get_current_account()
    print(f'Dropbox connected: {acct.name.display_name}')
    return dbx, dropbox


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    dry_run = '--dry-run' in sys.argv
    folders = args or DEFAULT_FOLDERS

    if not st.is_configured():
        print('ERROR: MEGA S4 not configured (set MEGA_S4_* env vars).')
        return 1

    dbx, dropbox = _dropbox_client()

    total_files = total_bytes = errors = 0
    for folder in folders:
        print(f'\n=== {folder} ===')
        try:
            res = dbx.files_list_folder(folder, recursive=True)
        except Exception as exc:
            print(f'  skip ({exc})')
            continue
        entries = list(res.entries)
        while res.has_more:
            res = dbx.files_list_folder_continue(res.cursor)
            entries.extend(res.entries)

        files = [e for e in entries if isinstance(e, dropbox.files.FileMetadata)]
        print(f'  {len(files)} files')
        for e in files:
            path = e.path_display
            if dry_run:
                print(f'  [dry] {path}')
                total_files += 1
                continue
            try:
                _meta, resp = dbx.files_download(path)
                st.upload_bytes(path, resp.content)
                total_files += 1
                total_bytes += len(resp.content)
                print(f'  OK {path} ({len(resp.content)} B)')
            except Exception as exc:
                errors += 1
                print(f'  ERR {path}: {exc}')

    print(f'\nDone: {total_files} files, {total_bytes/1e6:.1f} MB, {errors} errors'
          + (' (dry run — nothing uploaded)' if dry_run else ''))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
