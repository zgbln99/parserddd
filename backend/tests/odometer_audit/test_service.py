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
    assert 0 < mega['counts']['vehicles'] < 33 and drivers['counts']['vehicles'] == 0
    assert all(r['plate_norm'].startswith(('TFLS', 'TFKX')) for r in mega['rows'])

    by = {r['plate_norm']: r for r in mega['rows']}
    assert by['TFLS1192']['km'] == 338150 and by['TFLS1192']['quality'] == 'ok'
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
    assert 0 < rep['counts']['vehicles'] < 33
    assert all(r['plate_norm'].startswith(('TFLS', 'TFKX')) for r in rep['rows'])
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



def test_gen2_14_byte_registration_is_saved_and_reported(app_env):
    from tests.odometer_audit.synth_vu import DAYS, gen2
    client, fake, svc = app_env
    name = '/Old/M_20220110_TFLS1183.DDD'
    fake.blobs[name] = gen2('TF LS 1183', 'W1T96340310513069', DAYS, number_only=True)
    client.put('/api/odometer-audit/folders', json={'folders': ['/Old']})
    state = run_scan(client, 'mega')
    assert state['error_count'] == 0 and state['new_records'] >= 4
    with svc.get_db() as db:
        rec = db.query_one('SELECT kind, plate, error FROM card_scan_files WHERE path = ?', (name,))
        assert rec['kind'] == 'vu' and rec['plate'] == 'TF LS 1183' and rec['error'] == ''
    report = client.get('/api/odometer-audit/report?year=2021&source=mega').get_json()
    assert report['counts']['vehicles'] == 1
    assert report['rows'][0]['plate_norm'] == 'TFLS1183'
    assert report['rows'][0]['km'] == 455980
    assert report['rows'][0]['kind'] == 'midnight'


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

def test_year_end_picks_closest_on_both_sides_and_only_lts_fleet(app_env):
    client, fake, svc = app_env
    with svc.get_db() as db:
        def reading(plate, card, start, end, odo_begin, odo_end):
            db.execute(
                'INSERT INTO card_vehicle_usage (source, card_number, driver, plate_norm, plate, '
                'nation, vin, odo_begin, odo_end, first_use, last_use, file_id) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                ('mega', card, 'Test driver', svc.normalize_plate(plate), plate,
                 'D', '', odo_begin, odo_end, start, end, 0),
            )
        # January is 1.5 days away, December is nearly 6 days away.
        reading('TF LS 9901', 'c1', '2021-12-20T10:00:00Z', '2021-12-26T10:00:00Z', 100000, 100150)
        reading('TF LS 9901', 'c2', '2022-01-02T10:00:00Z', '2022-01-03T10:00:00Z', 100180, 100200)
        # Exact local 31 December card withdrawal; must outrank February.
        reading('TF KX 4000', 'c3', '2021-12-30T10:00:00Z', '2021-12-31T18:00:00Z', 555000, 555300)
        reading('TF KX 4000', 'c4', '2022-02-01T10:00:00Z', '2022-02-02T10:00:00Z', 555400, 555500)
        # Third-party vehicle is never part of the LTS report.
        reading('B AB 3130', 'external', '2021-12-31T10:00:00Z', '2021-12-31T18:00:00Z', 10000, 10100)
        # The same records in another source must not leak into MEGA.
        db.execute(
            'INSERT INTO card_vehicle_usage (source, card_number, driver, plate_norm, plate, '
            'nation, vin, odo_begin, odo_end, first_use, last_use, file_id) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ('archive', 'c9', '', 'TFLS9000', 'TF LS 9000',
             'D', '', 999, 1000, '2021-12-31T10:00:00Z', '2021-12-31T18:00:00Z', 0),
        )
        db.commit()
    resp = client.get('/api/odometer-audit/report?year=2021&source=mega')
    assert resp.status_code == 200
    report = resp.get_json()
    assert report['counts'] == {'vehicles': 2, 'active': 2, 'exact': 1, 'ok': 1, 'gap': 0, 'from_vu': 0}
    by = {r['plate_norm']: r for r in report['rows']}
    assert set(by) == {'TFLS9901', 'TFKX4000'}
    assert by['TFLS9901']['km'] == 100180
    assert by['TFLS9901']['source'] == 'after'
    assert by['TFLS9901']['quality'] == 'ok'
    assert by['TFLS9901']['after_at'] == '2022-01-02T10:00:00Z'
    assert by['TFKX4000']['km'] == 555300
    assert by['TFKX4000']['source'] == 'before'
    assert by['TFKX4000']['quality'] == 'exact'
    assert [r['plate_norm'] for r in report['rows']] == ['TFKX4000', 'TFLS9901']


def test_year_end_midnight_vu_wins_even_over_closer_card():
    from services.odometer_audit import _year_end_value
    before = {'kind': 'withdrawal', 'at': '2021-12-31T22:59:58Z', 'km': 455900}
    after = {'kind': 'midnight', 'at': '2022-01-01T00:00:00Z', 'km': 455980}
    choice, source = _year_end_value(before, after, '2021-12-31T22:59:59Z')
    assert source == 'midnight' and choice['km'] == 455980


def test_january_report_only_january_readings_and_lts_fleet(app_env):
    client, fake, svc = app_env

    with svc.get_db() as db:
        def card(plate, when, odometer, source='mega'):
            normalized = svc.normalize_plate(plate)
            db.execute(
                'INSERT INTO card_vehicle_usage '
                '(source, card_number, driver, plate_norm, plate, nation, vin, '
                'odo_begin, odo_end, first_use, last_use, file_id) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (source, f'card-{plate}-{when}', 'Test Driver', normalized, plate,
                 'D', '', odometer, odometer + 12, when, when, 0),
            )
        # 31.12 23:15 UTC is already 1 January in Germany.
        card('TF LS 9901', '2020-12-31T23:15:00Z', 1000)
        card('TF LS 9901', '2021-01-02T15:00:00Z', 1020)
        card('TF KX 4000', '2021-01-14T08:00:00Z', 5550)
        card('B AB 3130', '2021-01-01T10:00:00Z', 200)
        card('TF LS 9000', '2020-12-31T20:00:00Z', 300)  # December only
        card('TF LS 9001', '2021-02-01T10:00:00Z', 400)  # February only
        card('TF LS 8888', '2022-01-01T10:00:00Z', 500)  # different year
        card('TF LS 7777', '2021-01-01T10:00:00Z', 600, source='archive')
        db.execute(
            'INSERT INTO vu_odometer_days '
            '(source, plate_norm, plate, nation, vin, day, at, odo, file_id) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ('mega', 'TFLS9901', 'TF LS 9901', 'D', 'WMA1', '2021-01-01',
             '2021-01-01T00:00:00Z', 1010, 0),
        )
        db.commit()

    response = client.get('/api/odometer-audit/report?source=mega&year=2021&period=january')
    assert response.status_code == 200
    report = response.get_json()
    assert report['period'] == 'january'
    assert report['cutoff'] == '2020-12-31T23:00:00Z'
    assert report['counts'] == {
        'vehicles': 2, 'active': 2, 'exact': 1, 'ok': 1,
        'gap': 0, 'from_vu': 1,
    }
    assert {r['plate_norm'] for r in report['rows']} == {'TFLS9901', 'TFKX4000'}
    by = {r['plate_norm']: r for r in report['rows']}
    assert by['TFLS9901']['km'] == 1010
    assert by['TFLS9901']['kind'] == 'midnight'
    assert by['TFLS9901']['quality'] == 'exact'
    assert by['TFKX4000']['km'] == 5550
    assert by['TFKX4000']['quality'] == 'ok'
    assert by['TFKX4000']['at'] == '2021-01-14T08:00:00Z'
    assert by['TFKX4000']['km_in_year'] is None

    # Invalid mode is rejected, the legacy annual API remains unchanged.
    assert client.get('/api/odometer-audit/report?period=bad').status_code == 400
    annual = client.get('/api/odometer-audit/report?source=mega&year=2021').get_json()
    assert annual['period'] == 'year_end'
    assert annual['cutoff'].startswith('2021-12-31')
    january_next = client.get('/api/odometer-audit/report?source=mega&year=2022&period=january').get_json()
    assert {r['plate_norm'] for r in january_next['rows']} == {'TFLS8888'}

    tl = client.get('/api/odometer-audit/vehicle?source=mega&year=2021&period=january&plate=TFLS9901').get_json()
    assert tl['cutoff'] == '2020-12-31T23:00:00Z'
