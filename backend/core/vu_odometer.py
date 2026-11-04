"""Pure-Python reader for the odometer-relevant parts of a vehicle-unit
(tachograph) download file.

A VU download is a bare sequence of transfer-response blocks, each introduced
by the two bytes ``0x76 <TREP>`` and carrying no length field. Gen1 blocks
(TREP 01..05) have the fixed Annex 1B layout, so their extent is arithmetic
over count-prefixed record arrays; Gen2 blocks (TREP 21..25, and 31..35 for
Annex 1C v2) are runs of self-describing record arrays
``type(1) size(2) count(2) records…`` that end with the signature array.

What the audit needs from a VU file:
    * the vehicle's registration and VIN (Overview block),
    * the odometer at midnight of every downloaded day (Activities block,
      one block per calendar day),
    * the card insertion/withdrawal records with their odometer values
      (also in the Activities block), which mirror what the driver cards
      store and so fit the same table.
"""

from __future__ import annotations

from datetime import datetime, timezone

from core.card_vehicles import CODE_PAGES, NATIONS

TAG = 0x76
TREP_VERSION = 0x00
GEN1 = {0x01: 'overview', 0x02: 'activities', 0x03: 'events', 0x04: 'speed', 0x05: 'technical'}
GEN2 = {0x21: 'overview', 0x22: 'activities', 0x23: 'events', 0x24: 'speed', 0x25: 'technical',
        0x31: 'overview', 0x32: 'activities', 0x33: 'events', 0x35: 'technical'}

# Gen2 record types (Annex 1C, RecordType)
RT_ODOMETER_MIDNIGHT = 0x05
RT_DATE_OF_DAY = 0x06
RT_SIGNATURE = 0x08
RT_VIN = 0x0A
RT_REGISTRATION = 0x0B
RT_CARD_IW = 0x0D
RT_REGISTRATION_V2 = 0x24

# Gen1 widths (Annex 1B)
W_CERT = 194
W_SIG = 128
W_VIN = 17
W_REG = 15
W_IW1 = 129
W_PLACE1 = 28
W_SPEC = 5
W_FAULT1 = 82
W_EVENT1 = 83
W_OVERSPEED_EVT1 = 31
W_TIMEADJ1 = 98
W_SPEEDBLOCK = 64
W_CALIB1 = 167
GEN1_OVERVIEW_PREFIX = 2 * W_CERT + W_VIN + W_REG + 4 + 8 + 1 + 58


class VuFormatError(ValueError):
    pass


def is_vu_file(data: bytes) -> bool:
    return len(data) > 2 and data[0] == TAG and (data[1] == TREP_VERSION or data[1] in GEN1 or data[1] in GEN2)


def _u16(d: bytes, p: int) -> int:
    return int.from_bytes(d[p:p + 2], 'big')


def _u24(d: bytes, p: int) -> int:
    return int.from_bytes(d[p:p + 3], 'big')


def _time(d: bytes, p: int) -> str:
    secs = int.from_bytes(d[p:p + 4], 'big')
    if secs == 0 or secs == 0xFFFFFFFF:
        return ''
    try:
        return datetime.fromtimestamp(secs, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except (OverflowError, OSError, ValueError):
        return ''


def _text(raw: bytes) -> str:
    """CodePage byte + characters."""
    if not raw:
        return ''
    enc = CODE_PAGES.get(raw[0], 'latin-1')
    body = raw[1:].rstrip(b'\xff\x00 ')
    try:
        return body.decode(enc, errors='replace').strip()
    except LookupError:
        return body.decode('latin-1', errors='replace').strip()


def _registration(raw15: bytes) -> tuple[str, str]:
    """VehicleRegistrationIdentification: nation(1) + codepage(1) + 13 chars."""
    if len(raw15) < 15:
        return '', ''
    return NATIONS.get(raw15[0], str(raw15[0])), _text(raw15[1:15])


def _card_number(raw18: bytes) -> str:
    """FullCardNumber: cardType(1) + nation(1) + number(16)."""
    return raw18[2:18].rstrip(b'\xff\x00 ').decode('latin-1', errors='replace').strip()


def _holder(raw72: bytes) -> str:
    surname, first = _text(raw72[0:36]), _text(raw72[36:72])
    return ' '.join(x for x in (first, surname) if x).strip()


def _iw_record(r: bytes, gen2: bool) -> dict | None:
    """One VuCardIWRecord (Gen1 129 bytes, Gen2 131+ bytes)."""
    o = 91 if gen2 else 90  # offset of cardExpiryDate
    if len(r) < o + 20:
        return None
    rec = {
        'holder': _holder(r[0:72]),
        'card_number': _card_number(r[72:90]),
        'first_use': _time(r, o + 4),
        'odo_begin': _u24(r, o + 8),
        'slot': r[o + 11],
        'last_use': _time(r, o + 12),
        'odo_end': _u24(r, o + 16),
    }
    if not rec['first_use'] or not rec['last_use']:
        return None  # card still inserted at download time, or empty slot
    if rec['odo_begin'] == 0xFFFFFF or rec['odo_end'] == 0xFFFFFF:
        return None
    return rec


# ---------------------------------------------------------------------------
# Gen1
# ---------------------------------------------------------------------------

def _counted(d: bytes, p: int, width: int, count_bytes: int) -> tuple[int, int]:
    """Return (offset of first record, count) for a count-prefixed array."""
    if p + count_bytes > len(d):
        raise VuFormatError('truncated count')
    n = d[p] if count_bytes == 1 else _u16(d, p)
    p += count_bytes
    if p + n * width > len(d):
        raise VuFormatError('truncated record array')
    return p, n


def _gen1_block(trep: int, d: bytes, out: dict) -> int:
    """Parse what we need from one Gen1 block; return its payload length."""
    p = 0
    if trep == 0x01:
        if GEN1_OVERVIEW_PREFIX > len(d):
            raise VuFormatError('truncated overview')
        vin_off = 2 * W_CERT
        out['vin'] = d[vin_off:vin_off + W_VIN].rstrip(b'\xff\x00 ').decode('latin-1', errors='replace').strip()
        out['nation'], out['plate'] = _registration(d[vin_off + W_VIN:vin_off + W_VIN + W_REG])
        out['current_time'] = _time(d, vin_off + W_VIN + W_REG)
        p = GEN1_OVERVIEW_PREFIX
        p, n = _counted(d, p, 98, 1); p += n * 98        # company locks
        p, n = _counted(d, p, 31, 1); p += n * 31        # control activity
    elif trep == 0x02:
        if 7 > len(d):
            raise VuFormatError('truncated activities')
        day_at = _time(d, 0)
        odo = _u24(d, 4)
        if day_at and odo != 0xFFFFFF:
            out['days'].append({'day': day_at[:10], 'at': day_at, 'odo': odo})
        p = 7
        p, n = _counted(d, p, W_IW1, 2)
        for i in range(n):
            rec = _iw_record(d[p + i * W_IW1:p + (i + 1) * W_IW1], gen2=False)
            if rec:
                out['card_records'].append(rec)
        p += n * W_IW1
        p, n = _counted(d, p, 2, 2); p += n * 2          # activity changes
        p, n = _counted(d, p, W_PLACE1, 1); p += n * W_PLACE1
        p, n = _counted(d, p, W_SPEC, 2); p += n * W_SPEC
    elif trep == 0x03:
        p, n = _counted(d, 0, W_FAULT1, 1); p += n * W_FAULT1
        p, n = _counted(d, p, W_EVENT1, 1); p += n * W_EVENT1
        p += 9                                            # overspeeding control data
        p, n = _counted(d, p, W_OVERSPEED_EVT1, 1); p += n * W_OVERSPEED_EVT1
        p, n = _counted(d, p, W_TIMEADJ1, 1); p += n * W_TIMEADJ1
    elif trep == 0x04:
        p, n = _counted(d, 0, W_SPEEDBLOCK, 2); p += n * W_SPEEDBLOCK
    elif trep == 0x05:
        p = 116 + 20
        p, n = _counted(d, p, W_CALIB1, 1); p += n * W_CALIB1
    else:
        raise VuFormatError(f'unknown gen1 block {trep:02x}')
    if p + W_SIG > len(d):
        raise VuFormatError('truncated signature')
    return p + W_SIG


# ---------------------------------------------------------------------------
# Gen2 / Gen2v2
# ---------------------------------------------------------------------------

def _gen2_block(d: bytes, out: dict) -> int:
    """Walk the record arrays of one Gen2 block; return its payload length."""
    p = 0
    day_at, odo = '', None
    for _ in range(128):
        if p + 5 > len(d):
            raise VuFormatError('truncated record array header')
        rtype, size, count = d[p], _u16(d, p + 1), _u16(d, p + 3)
        p += 5
        end = p + size * count
        if end > len(d):
            raise VuFormatError('truncated record array')
        if rtype == RT_VIN and count and size >= 17:
            out['vin'] = d[p:p + 17].rstrip(b'\xff\x00 ').decode('latin-1', errors='replace').strip()
        elif rtype in (RT_REGISTRATION, RT_REGISTRATION_V2) and count and size >= 15 and not out.get('plate'):
            out['nation'], out['plate'] = _registration(d[p:p + 15])
        elif rtype == RT_DATE_OF_DAY and count and size >= 4:
            day_at = _time(d, p)
        elif rtype == RT_ODOMETER_MIDNIGHT and count and size >= 3:
            odo = _u24(d, p)
        elif rtype == RT_CARD_IW and size >= 110:
            for i in range(count):
                rec = _iw_record(d[p + i * size:p + (i + 1) * size], gen2=True)
                if rec:
                    out['card_records'].append(rec)
        p = end
        if rtype == RT_SIGNATURE:
            break
    else:
        raise VuFormatError('record array walk lost sync')
    if day_at and odo is not None and odo != 0xFFFFFF:
        out['days'].append({'day': day_at[:10], 'at': day_at, 'odo': odo})
    return p


# ---------------------------------------------------------------------------
# Whole file
# ---------------------------------------------------------------------------

def parse_vu(data: bytes) -> dict:
    """Registration, VIN, daily midnight odometers and card in/out records.

    Blocks are walked in file order; an unknown tag or trailing padding ends
    the walk (what was read before it is kept). Raises VuFormatError only
    when the first block cannot be read at all.
    """
    out: dict = {'vin': '', 'plate': '', 'nation': '', 'current_time': '', 'generation': 0,
                 'days': [], 'card_records': [], 'blocks': 0, 'warning': ''}
    p = 0
    while p + 2 <= len(data):
        if data[p] != TAG:
            break  # padding some download tools append
        trep = data[p + 1]
        payload = data[p + 2:]
        try:
            if trep == TREP_VERSION:
                n = 2
            elif trep in GEN1:
                out['generation'] = out['generation'] or 1
                n = _gen1_block(trep, payload, out)
            elif trep in GEN2:
                out['generation'] = 2
                n = _gen2_block(payload, out)
            else:
                out['warning'] = f'unknown block 0x76{trep:02x} at {p}'
                break
        except VuFormatError as exc:
            if out['blocks'] == 0:
                raise
            out['warning'] = f'{exc} in block 0x76{trep:02x} at {p}'
            break
        out['blocks'] += 1
        p += 2 + n

    # de-duplicate days (a VU may be downloaded repeatedly into one file set)
    seen: set = set()
    days = []
    for dday in sorted(out['days'], key=lambda x: x['at']):
        if dday['day'] in seen:
            continue
        seen.add(dday['day'])
        days.append(dday)
    out['days'] = days
    seen = set()
    recs = []
    for r in sorted(out['card_records'], key=lambda x: (x['first_use'], x['last_use'])):
        key = (r['card_number'], r['first_use'], r['last_use'])
        if key in seen:
            continue
        seen.add(key)
        recs.append(r)
    out['card_records'] = recs
    return out
