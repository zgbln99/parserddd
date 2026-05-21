#!/usr/bin/env python3
"""Manual smoke test for the MEGA S4 (S3-compatible) storage backend.

Run on a host that has the MEGA_S4_* env vars set:

    cd backend
    python test_storage_s4.py

It will, against a throwaway key under ``_selftest/``:
  1. upload a small test file,
  2. download it and verify the bytes match,
  3. verify the object is NOT publicly reachable (anonymous HTTP GET),
  4. delete it and verify it's gone.

Nothing here is wired into the app; it's a deployment check only.
"""

import os
import sys
import uuid

# Allow running from the backend/ dir.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load a .env (searched in cwd and parent dirs) so this test sees the same
# vars the app does. NOTE: systemd `Environment=` lines only apply to the
# service process — for this manual test put the vars in .env or export them.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from services import storage_service as st  # noqa: E402
from config import MEGA_S4_ENDPOINT, MEGA_S4_BUCKET  # noqa: E402


def main() -> int:
    if not st.is_configured():
        print('FAIL: MEGA S4 is not configured (set MEGA_S4_* env vars).')
        return 1

    key = f'_selftest/{uuid.uuid4().hex}.txt'
    payload = b'mega-s4 storage self test \xc3\xbc\xc3\xb6\xc3\xa4'
    ok = True

    # 1) upload
    try:
        st.upload_bytes(key, payload, content_type='text/plain')
        print(f'OK   upload   {key}')
    except Exception as exc:
        print(f'FAIL upload: {exc}')
        return 1

    # 2) download + verify
    try:
        got = st.download_bytes(key)
        if got == payload:
            print('OK   download (bytes match)')
        else:
            print(f'FAIL download: bytes differ ({len(got)} vs {len(payload)})')
            ok = False
    except Exception as exc:
        print(f'FAIL download: {exc}')
        ok = False

    # 3) head
    try:
        meta = st.head(key)
        print(f'OK   head     size={meta.get("size")} etag={meta.get("etag")}')
    except Exception as exc:
        print(f'WARN head: {exc}')

    # 4) public-access check — anonymous GET must NOT succeed
    try:
        import requests
        url = f"{MEGA_S4_ENDPOINT.rstrip('/')}/{MEGA_S4_BUCKET}/{key}"
        r = requests.get(url, timeout=15)
        if r.status_code == 200:
            print(f'FAIL public access: object is PUBLICLY readable at {url}')
            ok = False
        else:
            print(f'OK   private  (anonymous GET -> HTTP {r.status_code})')
    except Exception as exc:
        # A connection/refusal also means "not public".
        print(f'OK   private  (anonymous GET failed: {exc})')

    # 5) missing-file behaviour
    try:
        st.download_bytes(key + '.nope')
        print('FAIL not-found: expected StorageFileNotFound')
        ok = False
    except st.StorageFileNotFound:
        print('OK   not-found raises StorageFileNotFound')
    except Exception as exc:
        print(f'WARN not-found raised {type(exc).__name__}: {exc}')

    # 6) delete + verify gone
    try:
        st.delete(key)
        if st.head(key) is None:
            print('OK   delete   (object gone)')
        else:
            print('FAIL delete: object still present')
            ok = False
    except Exception as exc:
        print(f'FAIL delete: {exc}')
        ok = False

    print('\n' + ('ALL GOOD' if ok else 'THERE WERE FAILURES'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
