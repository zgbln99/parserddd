#!/usr/bin/env python3
"""One-shot migration: copy files from the old Dropbox into MEGA S4.

Reuses the app's existing (app-folder-scoped) Dropbox refresh token on the
read side and the new storage_service on the write side, so object keys
keep the exact same paths (minus the leading slash).

Fast + resumable:
* lists all files first, then copies them with a thread pool (--workers),
* skips files already present in S4 with the same size, so re-running after
  a dropped connection just finishes the rest.

Usage (on the server, in the venv):

    pip install dropbox
    export DROPBOX_REFRESH_TOKEN=...     # if not already in env / .env
    cd backend
    python migrate_dropbox_to_s4.py --dry-run
    python migrate_dropbox_to_s4.py --workers 16

    # survive SSH disconnects:
    nohup python migrate_dropbox_to_s4.py --workers 16 > /tmp/migrate.log 2>&1 &
    tail -f /tmp/migrate.log
"""

import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

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

_local = threading.local()
_lock = threading.Lock()


def _dbx():
    """Thread-local Dropbox client (the SDK isn't guaranteed thread-safe)."""
    c = getattr(_local, 'dbx', None)
    if c is None:
        import dropbox
        c = dropbox.Dropbox(
            oauth2_refresh_token=os.environ.get('DROPBOX_REFRESH_TOKEN', ''),
            app_key=os.environ.get('DROPBOX_APP_KEY', '') or 'j9ntkihedd9495i',
            app_secret=os.environ.get('DROPBOX_APP_SECRET', '') or 'd3hr43reha9kky8',
        )
        _local.dbx = c
    return c


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    dry_run = '--dry-run' in sys.argv
    workers = 8
    for a in sys.argv:
        if a.startswith('--workers'):
            try:
                workers = int(a.split('=')[1]) if '=' in a else int(sys.argv[sys.argv.index(a) + 1])
            except (ValueError, IndexError):
                pass
    folders = args or DEFAULT_FOLDERS

    if not st.is_configured():
        print('ERROR: MEGA S4 not configured (set MEGA_S4_* env vars).')
        return 1
    if not os.environ.get('DROPBOX_REFRESH_TOKEN'):
        print('ERROR: DROPBOX_REFRESH_TOKEN not set (export it or put it in .env)')
        return 1

    try:
        import dropbox
    except ImportError:
        print('ERROR: dropbox SDK not installed — run:  pip install dropbox')
        return 1

    acct = _dbx().users_get_current_account()
    print(f'Dropbox connected: {acct.name.display_name}  | workers={workers}'
          + ('  | DRY RUN' if dry_run else ''))

    # 1) list everything (fast, single-threaded)
    todo = []  # (path, size)
    for folder in folders:
        try:
            res = _dbx().files_list_folder(folder, recursive=True)
        except Exception as exc:
            print(f'  skip {folder} ({exc})')
            continue
        entries = list(res.entries)
        while res.has_more:
            res = _dbx().files_list_folder_continue(res.cursor)
            entries.extend(res.entries)
        files = [e for e in entries if isinstance(e, dropbox.files.FileMetadata)]
        print(f'  {folder}: {len(files)} files')
        for e in files:
            todo.append((e.path_display, e.size))

    print(f'Total candidates: {len(todo)}')
    if dry_run:
        for p, s in todo[:50]:
            print(f'  [dry] {p} ({s} B)')
        if len(todo) > 50:
            print(f'  … and {len(todo) - 50} more')
        return 0

    state = {'copied': 0, 'skipped': 0, 'errors': 0, 'done': 0}

    def _one(path, size):
        try:
            existing = st.head(path)
            if existing and existing.get('size') == size:
                with _lock:
                    state['skipped'] += 1
                return
            _meta, resp = _dbx().files_download(path)
            st.upload_bytes(path, resp.content)
            with _lock:
                state['copied'] += 1
        except Exception as exc:
            with _lock:
                state['errors'] += 1
            print(f'  ERR {path}: {exc}')
        finally:
            with _lock:
                state['done'] += 1
                if state['done'] % 50 == 0:
                    print(f"  … {state['done']}/{len(todo)} "
                          f"(copied {state['copied']}, skipped {state['skipped']}, err {state['errors']})")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_one, p, s) for p, s in todo]
        for _ in as_completed(futs):
            pass

    print(f"\nDone: copied {state['copied']}, skipped {state['skipped']}, "
          f"errors {state['errors']} of {len(todo)}.")
    return 1 if state['errors'] else 0


if __name__ == '__main__':
    sys.exit(main())
