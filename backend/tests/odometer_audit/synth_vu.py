"""Builds synthetic Gen1 and Gen2 VU download files following Annex 1B/1C layouts."""
import struct, time, calendar

def treal(iso):
    import datetime as dt
    d = dt.datetime.strptime(iso, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
    return struct.pack('>I', int(d.timestamp()))
def u24(n): return n.to_bytes(3, 'big')
def text(s, n): return b'\x01' + s.encode('latin-1').ljust(n - 1, b' ')
def holder(sur, first): return text(sur, 36) + text(first, 36)
def fullcard(num): return b'\x01\x0d' + num.encode().ljust(16, b' ')
def reg(plate): return b'\x0d' + text(plate, 14)

def iw1(sur, first, card, ins, odo_in, wd, odo_out):
    r = holder(sur, first) + fullcard(card) + treal('2027-01-01T00:00:00Z') + treal(ins) + u24(odo_in) + b'\x01' + treal(wd) + u24(odo_out) + reg('XX') + treal(ins) + b'\x00'
    assert len(r) == 129, len(r); return r
def iw2(sur, first, card, ins, odo_in, wd, odo_out):
    r = holder(sur, first) + fullcard(card) + b'\x01' + treal('2027-01-01T00:00:00Z') + treal(ins) + u24(odo_in) + b'\x01' + treal(wd) + u24(odo_out) + reg('XX') + treal(ins) + b'\x01' + b'\x00'
    assert len(r) == 131, len(r); return r

def gen1(plate, vin, days):
    f = b'\x76\x01' + b'\xaa' * 194 + b'\xbb' * 194 + vin.encode().ljust(17, b' ') + reg(plate) + treal('2022-01-10T08:00:00Z') + treal('2021-12-01T00:00:00Z') + treal('2022-01-10T00:00:00Z') + b'\x00' + b'\x00' * 58 + b'\x01' + b'\x11' * 98 + b'\x00' + b'\x55' * 128
    for day, odo, recs in days:
        body = treal(day + 'T00:00:00Z') + u24(odo) + struct.pack('>H', len(recs)) + b''.join(iw1(*r) for r in recs)
        body += struct.pack('>H', 2) + b'\x00\x00\x00\x00'            # 2 activity changes
        body += b'\x01' + b'\x22' * 28                                   # 1 place record
        body += struct.pack('>H', 0)                                     # specific conditions
        f += b'\x76\x02' + body + b'\x66' * 128
    # events block (TREP 03): 0 faults, 0 events, overspeed ctl 9, 0 overspeed events, 0 time adj, sig
    f += b'\x76\x03' + b'\x00' + b'\x00' + b'\x00' * 9 + b'\x00' + b'\x00' + b'\x77' * 128
    f += b'\x76\x04' + struct.pack('>H', 1) + b'\x00' * 64 + b'\x88' * 128
    f += b'\x76\x05' + b'\x00' * 116 + b'\x00' * 20 + b'\x00' + b'\x99' * 128
    return f

def arr(rtype, records, size=None):
    size = size if size is not None else (len(records[0]) if records else 0)
    return bytes([rtype]) + struct.pack('>HH', size, len(records)) + b''.join(records)

def gen2(plate, vin, days, v2=False):
    ov = 0x31 if v2 else 0x21; ac = 0x32 if v2 else 0x22
    f = b'\x76\x00' + b'\x01\x00'
    f += b'\x76' + bytes([ov]) + arr(0x04, [b'\xaa' * 204]) + arr(0x0f, [b'\xbb' * 204]) + arr(0x0a, [vin.encode().ljust(17, b' ')]) \
        + arr(0x24 if v2 else 0x0b, [reg(plate)]) + arr(0x03, [treal('2022-01-10T08:00:00Z')]) + arr(0x13, [treal('2021-12-01T00:00:00Z') + treal('2022-01-10T00:00:00Z')]) \
        + arr(0x02, [b'\x00']) + arr(0x14, [b'\x00' * 59]) + arr(0x10, [], 99) + arr(0x11, [], 31) + arr(0x08, [b'\x55' * 64])
    for day, odo, recs in days:
        f += b'\x76' + bytes([ac]) + arr(0x06, [treal(day + 'T00:00:00Z')]) + arr(0x05, [u24(odo)]) + arr(0x0d, [iw2(*r) for r in recs], 131) \
            + arr(0x01, [b'\x00\x00', b'\x00\x00']) + arr(0x1c, [], 29) + arr(0x16, [], 25) + arr(0x09, [], 5) + arr(0x08, [b'\x66' * 64])
    f += b'\x76' + bytes([0x33 if v2 else 0x23]) + arr(0x15, [], 90) + arr(0x18, [], 90) + arr(0x08, [b'\x77' * 64])
    return f

DAYS = [
    ('2021-12-30', 455100, [('KOWALSKI', 'JAN', '1000000168070600', '2021-12-30T05:00:00Z', 455100, '2021-12-30T15:30:00Z', 455620)]),
    ('2021-12-31', 455620, [('KOWALSKI', 'JAN', '1000000168070600', '2021-12-31T05:10:00Z', 455620, '2021-12-31T13:00:00Z', 455980)]),
    ('2022-01-01', 455980, []),
    ('2022-01-03', 455980, [('NOWAK', 'ANNA', '1000000199990000', '2022-01-03T04:00:00Z', 455980, '2022-01-03T16:00:00Z', 456410)]),
]
if __name__ == '__main__':
    import sys
    out = sys.argv[1]
    open(f'{out}/vu_gen1.ddd', 'wb').write(gen1('TF LS 2262', 'WMA06XZZ1LM000001', DAYS))
    open(f'{out}/vu_gen2.ddd', 'wb').write(gen2('TF LS 1190', 'WMA06XZZ1LM000002', DAYS))
    open(f'{out}/vu_gen2v2.ddd', 'wb').write(gen2('TF LS 3043', 'WMA06XZZ1LM000003', DAYS, v2=True) + b'\xff' * 16)
    print('written')
