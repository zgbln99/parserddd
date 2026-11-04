"""The two pure-Python tachograph file readers."""

import collections

from core.card_vehicles import is_non_driver_card, parse_card_vehicles
from core.vu_odometer import is_vu_file, parse_vu


def test_card_gen1_records(card_gen1):
    r = parse_card_vehicles(card_gen1)
    assert r['card_number'] == '1880301040190000'
    assert r['holder'] == 'Wojciech Piotr Kubalski'
    assert len(r['records']) == 200
    plates = collections.Counter(x['plate'] for x in r['records'])
    assert plates['TF LS2262'] == 129
    assert all(x['odo_end'] >= x['odo_begin'] and x['last_use'] >= x['first_use'] for x in r['records'])
    assert {x['nation'] for x in r['records']} == {'D'}


def test_card_gen2_file_merges_both_generations(card_gen2):
    r = parse_card_vehicles(card_gen2)
    assert r['card_number'] == '1680706007330002'
    assert len(r['records']) == 130  # Gen1 + Gen2 blocks de-duplicated
    assert not is_vu_file(card_gen2)


def test_vu_all_generations(vu_files):
    for name, data in vu_files.items():
        assert is_vu_file(data), name
        r = parse_vu(data)
        assert r['plate'] and r['vin'].startswith('WMA06XZZ1LM'), name
        assert r['nation'] == 'D'
        assert [(d['day'], d['odo']) for d in r['days']] == [
            ('2021-12-30', 455100), ('2021-12-31', 455620), ('2022-01-01', 455980), ('2022-01-03', 455980)]
        assert len(r['card_records']) == 3
        assert r['card_records'][0]['holder'] == 'JAN KOWALSKI'
        assert r['card_records'][0]['card_number'] == '1000000168070600'
        assert not r['warning'], (name, r['warning'])
    assert parse_vu(vu_files['gen1'])['generation'] == 1
    assert parse_vu(vu_files['gen2'])['generation'] == 2


def test_vu_truncated_file_keeps_what_was_read(vu_files):
    data = vu_files['gen1']
    cut = data[: len(data) - 300]  # inside the technical-data block
    r = parse_vu(cut)
    assert r['plate'] == 'TF LS 2262' and len(r['days']) == 4
    assert r['warning']


def _other_card_fixture():
    """TLV structure of a non-driver card; FIDs match real CC_* files."""
    def tlv(fid, payload):
        return fid.to_bytes(2, 'big') + b'\x00' + len(payload).to_bytes(2, 'big') + payload
    return (tlv(0x0002, b'\x00' * 25) + tlv(0x0005, b'\x00') +
            tlv(0x0501, b'\x00' * 16) + tlv(0xC100, b'\x00' * 8) +
            tlv(0xC108, b'\x00' * 8))


def test_recognizes_other_tachograph_card_from_content(card_gen1):
    assert is_non_driver_card(_other_card_fixture())
    assert not is_non_driver_card(card_gen1)
    assert not is_non_driver_card(b'not a ddd')
