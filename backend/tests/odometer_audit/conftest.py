"""Fixtures for the year-end odometer audit tests.

Everything runs against a throw-away SQLite file and a fake in-memory
storage, so no MEGA credentials are needed. Run from backend/:

    python -m pytest tests/odometer_audit -q
"""

import io
import json
import os
import sys
import time
import zipfile

import pytest

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPO = os.path.abspath(os.path.join(BACKEND, '..'))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

# Two real driver-card downloads kept in the repository as test data.
CARD_GEN1 = os.path.join(BACKEND, 'tachograph-1880301040190000-1775105858771 (1).ddd')
CARD_GEN2 = os.path.join(REPO, 'C_20260312_1153_T_Goliasz_16807060073300.DDD')


@pytest.fixture
def card_gen1() -> bytes:
    return open(CARD_GEN1, 'rb').read()


@pytest.fixture
def card_gen2() -> bytes:
    return open(CARD_GEN2, 'rb').read()


@pytest.fixture
def vu_files():
    from tests.odometer_audit import synth_vu as sv
    return {
        'gen1': sv.gen1('TF LS 2262', 'WMA06XZZ1LM000001', sv.DAYS),
        'gen2': sv.gen2('TF LS 1190', 'WMA06XZZ1LM000002', sv.DAYS),
        'gen2v2': sv.gen2('TF LS 3043', 'WMA06XZZ1LM000003', sv.DAYS, v2=True) + b'\xff' * 16,
    }


class FakeStorage:
    """Stands in for services.storage_service: a dict of path -> bytes."""

    def __init__(self):
        self.blobs: dict[str, bytes] = {}

    def is_configured(self):
        return True

    def download_bytes(self, path):
        return self.blobs[path]

    def upload_bytes(self, path, data, content_type=None):
        self.blobs[path] = data
        return {'path': path}

    def list_prefix(self, prefix):
        return [{'path_display': p, 'name': p.rsplit('/', 1)[-1], 'size': len(b)}
                for p, b in self.blobs.items() if p.startswith(prefix.rstrip('/') + '/')]

    def list_folder(self, path):
        pfx = path.strip('/') + '/' if path.strip('/') else ''
        folders, files = {}, []
        for k, b in self.blobs.items():
            key = k.lstrip('/')
            if not key.startswith(pfx):
                continue
            rest = key[len(pfx):]
            if '/' in rest:
                folders[rest.split('/', 1)[0]] = True
            else:
                files.append({'name': rest, 'path': '/' + key, 'size': len(b)})
        return {'path': '/' + pfx.rstrip('/') if pfx else '/',
                'folders': [{'name': n, 'path': '/' + pfx + n} for n in sorted(folders)], 'files': files}


@pytest.fixture
def app_env(tmp_path, monkeypatch):
    """A Flask app on a fresh SQLite DB with storage faked out; yields
    (test_client logged in as admin, FakeStorage, service module)."""
    data = tmp_path / 'data'
    data.mkdir()
    monkeypatch.setenv('DATA_DIR', str(data))
    monkeypatch.setenv('DATABASE_FILE', str(data / 'app.db'))
    monkeypatch.setenv('PORTAL_CACHE_FILE', str(data / 'portal_cache.json'))
    monkeypatch.setenv('ADMIN_USERNAME', 'admin')
    monkeypatch.setenv('ADMIN_PASSWORD', 'TestPass123')
    monkeypatch.setenv('FLASK_SECRET_KEY', 'test')
    monkeypatch.setenv('SYNC_DEST_FOLDER', '/Samsara-DDD')
    (data / 'portal_cache.json').write_text('[]')

    # config.py reads the environment at import time: reload it and the
    # modules that captured its values.
    for mod in [m for m in list(sys.modules) if m in ('config', 'database', 'app') or m.startswith(('services.', 'routes.', 'auth.', 'core.'))]:
        sys.modules.pop(mod, None)
    import services.odometer_audit as svc
    fake = FakeStorage()
    for name in ('is_configured', 'download_bytes', 'upload_bytes', 'list_prefix', 'list_folder'):
        monkeypatch.setattr(svc.storage_service, name, getattr(fake, name))
    from app import create_app
    app = create_app()
    app.config['TESTING'] = True
    client = app.test_client()
    r = client.post('/api/auth/login', json={'username': 'admin', 'password': 'TestPass123'})
    assert r.status_code == 200, r.data
    yield client, fake, svc


def run_scan(client, source, **kw):
    r = client.post('/api/odometer-audit/scan', json={'source': source, 'refresh': False, **kw}).get_json()
    assert r['started'], r
    for _ in range(200):
        st = client.get('/api/odometer-audit/scan/status').get_json()
        if not st['running']:
            return st
        time.sleep(0.05)
    raise AssertionError('scan did not finish')


def multipart(files):
    return {'files': [(io.BytesIO(data), name) for name, data in files]}


def make_zip(entries: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()
