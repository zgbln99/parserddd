"""Pure-Python reader for the "vehicles used" block of a driver-card .ddd file.

A driver card stores, per vehicle it was inserted in, the odometer at
insertion and at withdrawal plus the timestamps (EF_Vehicles_Used, file id
0x0505). That is enough to reconstruct a vehicle's odometer on any date
from the cards of the drivers who used it, which is what the year-end
odometer audit needs. No external parser: the block is a fixed-size record
array, read directly from the TLV download file.

Card download file layout (Annex 1B / 1C): a sequence of
``FID(2) TYPE(1) LENGTH(2) DATA``. TYPE 00 = Gen1 data, 01 = its signature,
02 = Gen2 data, 03 = its signature. Gen1 records are 31 bytes, Gen2 records
48 bytes (they add the VIN).
"""

from __future__ import annotations

from datetime import datetime, timezone

EF_VEHICLES_USED = 0x0505
EF_IDENTIFICATION = 0x0520

CODE_PAGES = {
    0x01: 'latin-1', 0x02: 'iso8859-2', 0x03: 'iso8859-3', 0x05: 'iso8859-5',
    0x07: 'iso8859-7', 0x09: 'iso8859-9', 0x0D: 'iso8859-13', 0x0F: 'iso8859-15',
    0x10: 'iso8859-16', 0x50: 'koi8-r', 0x55: 'koi8-u',
}

# Numeric nation code -> country letters (Annex 1B NationNumeric), the ones
# that matter for a Polish/German fleet plus neighbours.
NATIONS = {
    1: 'A', 2: 'AL', 3: 'AND', 4: 'ARM', 5: 'AZ', 6: 'B', 7: 'BG', 8: 'BIH', 9: 'BY', 10: 'CH',
    11: 'CY', 12: 'CZ', 13: 'D', 14: 'DK', 15: 'E', 16: 'EST', 17: 'F', 18: 'FIN', 19: 'FL', 20: 'FR',
    21: 'UK', 22: 'GE', 23: 'GR', 24: 'H', 25: 'HR', 26: 'I', 27: 'IRL', 28: 'IS', 29: 'KZ', 30: 'L',
    31: 'LT', 32: 'LV', 33: 'M', 34: 'MC', 35: 'MD', 36: 'MK', 37: 'N', 38: 'NL', 39: 'P', 40: 'PL',
    41: 'RO', 42: 'RSM', 43: 'RUS', 44: 'S', 45: 'SK', 46: 'SLO', 47: 'TM', 48: 'TR', 49: 'UA', 50: 'V',
    51: 'YU', 52: 'MNE', 53: 'SRB', 54: 'UZ', 55: 'TJ', 56: 'KG', 57: 'RKS', 253: 'EC', 254: 'EUR', 255: 'RFU',
}


def _decode_text(raw: bytes) -> str:
    """CodePage byte + characters; unused bytes are 0xFF or 0x00."""
    if not raw:
        return ''
    enc = CODE_PAGES.get(raw[0], 'latin-1')
    body = raw[1:].rstrip(b'\xff\x00 ')
    try:
        return body.decode(enc, errors='replace').strip()
    except LookupError:
        return body.decode('latin-1', errors='replace').strip()


def _time(raw: bytes) -> str:
    """TimeReal (seconds since 1970 UTC) -> ISO 'YYYY-MM-DDTHH:MM:SSZ', '' when unset."""
    secs = int.from_bytes(raw, 'big')
    if secs == 0 or secs == 0xFFFFFFFF:
        return ''
    try:
        return datetime.fromtimestamp(secs, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except (OverflowError, OSError, ValueError):
        return ''


def iter_tlv(data: bytes):
    """Yield (fid, type, payload) for every block of a card download file."""
    i, n = 0, len(data)
    while i + 5 <= n:
        fid = int.from_bytes(data[i:i + 2], 'big')
        typ = data[i + 2]
        length = int.from_bytes(data[i + 3:i + 5], 'big')
        payload = data[i + 5:i + 5 + length]
        if len(payload) < length:
            break
        yield fid, typ, payload
        i += 5 + length


def is_non_driver_card(data: bytes) -> bool:
    """Recognize valid company/control/workshop-style card downloads.

    These contain common card-identification/signature TLVs (0x0002, 0x0501,
    0xC108) but no driver identity (0x0520) or vehicles-used (0x0505).
    They cannot provide a vehicle's odometer and should be recorded as
    non-applicable rather than corrupted driver-card downloads.
    Detection relies on FIDs, never on the filename.
    """
    fids = {fid for fid, typ, payload in iter_tlv(data)}
    return (0x0002 in fids and 0x0501 in fids and 0xC108 in fids
            and 0x0520 not in fids and 0x0505 not in fids)


def _records(payload: bytes, generation: int) -> list[dict]:
    rec_len = 31 if generation == 1 else 48
    out = []
    if len(payload) < 2:
        return out
    # 2-byte pointer to the newest record, then the ring buffer of records.
    body = payload[2:]
    for off in range(0, len(body) - rec_len + 1, rec_len):
        r = body[off:off + rec_len]
        odo_begin = int.from_bytes(r[0:3], 'big')
        odo_end = int.from_bytes(r[3:6], 'big')
        first_use = _time(r[6:10])
        last_use = _time(r[10:14])
        nation = r[14]
        plate = _decode_text(r[15:29])
        vin = ''
        if generation == 2:
            vin = r[31:48].rstrip(b'\xff\x00 ').decode('latin-1', errors='replace').strip()
        if not first_use and not last_use and odo_begin == 0 and odo_end == 0:
            continue  # empty slot
        if odo_begin == 0xFFFFFF or odo_end == 0xFFFFFF:
            continue
        if not plate:
            continue
        out.append({
            'plate': plate,
            'nation': NATIONS.get(nation, str(nation)),
            'vin': vin,
            'odo_begin': odo_begin,
            'odo_end': odo_end,
            'first_use': first_use,
            'last_use': last_use,
            'generation': generation,
        })
    return out


def parse_identification(payload: bytes) -> dict:
    """EF_Identification (0x0520): card number and holder name."""
    if len(payload) < 143:
        return {}
    return {
        'card_number': payload[1:17].rstrip(b'\xff\x00 ').decode('latin-1', errors='replace').strip(),
        'surname': _decode_text(payload[65:101]),
        'first_names': _decode_text(payload[101:137]),
    }


def parse_card_vehicles(data: bytes) -> dict:
    """Return {'card_number', 'holder', 'records': [...]} for a driver-card file.

    Records from both generations are merged and de-duplicated on
    (plate, first_use, last_use); a Gen2 card download carries the same
    usage in its Gen1 and Gen2 blocks.
    """
    ident: dict = {}
    records: list[dict] = []
    seen: set = set()
    for fid, typ, payload in iter_tlv(data):
        if fid == EF_IDENTIFICATION and typ in (0, 2) and not ident:
            ident = parse_identification(payload)
        elif fid == EF_VEHICLES_USED and typ in (0, 2):
            for rec in _records(payload, 1 if typ == 0 else 2):
                key = (rec['plate'], rec['first_use'], rec['last_use'])
                if key in seen:
                    continue
                seen.add(key)
                records.append(rec)
    records.sort(key=lambda r: (r['first_use'], r['last_use']))
    holder = ' '.join(x for x in (ident.get('first_names', ''), ident.get('surname', '')) if x).strip()
    return {'card_number': ident.get('card_number', ''), 'holder': holder, 'records': records}
