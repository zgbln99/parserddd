"""End-to-end: scan sources, reports per source, uploads, MEGA folders."""

from tests.odometer_audit.conftest import make_zip, multipart, run_scan


def test_sources_are_kept_apart(app_env, card_gen1, card_gen2):
    client, fake, svc = app_env
    fake.blobs['/Old/2021/kubalski.C1B'] = card_gen1
    fake.blobs['/Old/2021/goliasz.ESM'] = card_gen2
    fake.blobs['/Old/liste.xlsx'] = b'x'

    st = run_scan(client, 'mega')
    assert st['message'].startswith('failed')  # no folder picked yet

    client.put('/api/odometer-audit/folders', json={'folders': ['/Old']})
    st = run_scan(client, 'mega')
    assert (st['total'], st['new_records'], st['error_count']) == (2, 330, 0)

    mega = client.get('/api/odometer-audit/report?year=2025&source=mega').get_json()
    drivers = client.get('/api/odometer-audit/report?year=2025&source=drivers').get_json()
    assert mega['counts']['vehicles'] == 33 and drivers['counts']['vehicles'] == 0

    by = {r['plate_norm']: r for r in mega['rows']}
    assert by['TFLS1192']['km'] == 338150 and by['TFLS1192']['quality'] == 'exact'
    assert by['TFLS2232']['bracket_km'] == 27139
    assert any(r['plate_norm'] == 'TFLS2262' and r['plate'] == 'TF LS2262' for r in mega['rows'])  # most common spelling

    # a rescan skips what is already in the database
    st = run_scan(client, 'mega')
    assert st['total'] == 0 and st['skipped'] == 2


def test_upload_zip_dedupe_and_archive_source(app_env, card_gen1, card_gen2):
    client, fake, svc = app_env
    z = make_zip({'stare/2024/kubalski.ddd': card_gen1, 'stare/goliasz.DDD': card_gen2, 'readme.txt': 'x'})
    r = client.post('/api/odometer-audit/upload', data={'keep': '1', **multipart([('kubalski (1).ddd', card_gen1), ('archiwum.zip', z), ('bad.ddd', b'xx')])},
                    content_type='multipart/form-data').get_json()
    assert r['counts'] == {'new': 3, 'skipped': 0, 'error': 1}
    assert all(p.startswith('/Archiv-Fahrerkarten/') for p in fake.blobs)
    r = client.post('/api/odometer-audit/upload', data={'keep': '1', **multipart([('kubalski (1).ddd', card_gen1)])}, content_type='multipart/form-data').get_json()
    assert r['counts']['skipped'] == 1
    rep = client.get('/api/odometer-audit/report?year=2025&source=archive').get_json()
    assert rep['counts']['vehicles'] == 33
    assert client.get('/api/odometer-audit/report?year=2025&source=drivers').get_json()['counts']['vehicles'] == 0


def test_vehicle_unit_files_give_midnight_readings(app_env, card_gen1, vu_files):
    client, fake, svc = app_env
    fake.blobs['/Old/M_TFLS2262.DDD'] = vu_files['gen1']
    fake.blobs['/Old/M_TFLS1190.ddd'] = vu_files['gen2']
    fake.blobs['/Old/C_kubalski.ddd'] = card_gen1
    client.put('/api/odometer-audit/folders', json={'folders': ['/Old']})
    st = run_scan(client, 'mega')
    assert st['error_count'] == 0 and st['total'] == 3

    s = client.get('/api/odometer-audit/summary').get_json()['by_source']['mega']
    assert (s['vu_files'], s['card_files'], s['vu_days']) == (2, 1, 8)

    rep = client.get('/api/odometer-audit/report?year=2021&source=mega').get_json()
    assert rep['counts'] == {'vehicles': 2, 'active': 2, 'exact': 2, 'ok': 0, 'gap': 0, 'from_vu': 2}
    by = {r['plate_norm']: r for r in rep['rows']}
    assert by['TFLS2262']['km'] == 455980 and by['TFLS2262']['kind'] == 'midnight' and by['TFLS2262']['gap_days'] == 0.0
    assert by['TFLS2262']['before_kind'] == 'withdrawal'  # 31.12 13:00 is later than that day's midnight reading

    tl = client.get('/api/odometer-audit/vehicle?plate=TF%20LS%202262&year=2021&source=mega').get_json()
    assert tl['vu_days'] == 4 and [x['kind'] for x in tl['records']].count('midnight') == 4

    r = client.post('/api/odometer-audit/upload', data={'keep': '1', **multipart([('M_x.DDD', vu_files['gen2'])])}, content_type='multipart/form-data').get_json()
    assert r['results'][0]['kind'] == 'vu' and r['results'][0]['path'].startswith('/Archiv-Fahrerkarten/VU_TFLS1190/')


def test_folder_picker_and_settings(app_env, card_gen1):
    client, fake, svc = app_env
    fake.blobs['/Samsara-DDD/Kontrola/Archiv/2021/a.C1B'] = card_gen1
    fake.blobs['/Samsara-DDD/Kontrola/Archiv/liste.txt'] = b'x'
    b = client.get('/api/odometer-audit/storage/browse?path=/Samsara-DDD/Kontrola/Archiv').get_json()
    assert [f['name'] for f in b['folders']] == ['2021'] and b['ddd_files'] == 0 and b['other_files'] == 1
    b = client.get('/api/odometer-audit/storage/browse?path=/Samsara-DDD/Kontrola/Archiv/2021').get_json()
    assert b['ddd_files'] == 1 and b['sample'] == ['a.C1B']
    r = client.put('/api/odometer-audit/folders', json={'folders': ['/Samsara-DDD/Kontrola/Archiv', '/x/../y', '']}).get_json()
    assert r['folders'] == ['/Samsara-DDD/Kontrola/Archiv']


def test_non_driver_card_is_skipped_without_false_error(app_env):
    from tests.odometer_audit.test_parsers import _other_card_fixture
    client, fake, svc = app_env
    fake.blobs['/Other/CC_company.ddd'] = _other_card_fixture()
    client.put('/api/odometer-audit/folders', json={'folders': ['/Other']})
    st = run_scan(client, 'mega')
    assert st['total'] == 1 and st['error_count'] == 0
    assert st['new_records'] == 0
    with svc.get_db() as db:
        row = db.query_one('SELECT kind, error, records FROM card_scan_files WHERE path = ?', ('/Other/CC_company.ddd',))
        assert row['kind'] == 'other' and row['error'] == '' and row['records'] == 0
    assert client.get('/api/odometer-audit/report?year=2021&source=mega').get_json()['counts']['vehicles'] == 0
    st = run_scan(client, 'mega')
    assert st['total'] == 0 and st['skipped'] == 1
