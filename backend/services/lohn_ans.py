"""
Parser for DATEV LohnViewer ASCII exports (.ans / .ans files).

A LohnViewer ``.ans`` export is a fixed-layout ANSI text dump of one or more
payslips. Each payslip page carries a month header ("für Juli 2024"), the
employee's Personal-Nr and name, and the wage-type (Lohnart) lines. We extract,
per employee and per calendar month, the **25% Nachtzuschlag hours** — the field
the Stundenzettel generator needs to line its computed night hours up with the
payroll run.

Robustness details:
- Nachberechnung (correction) pages read "für Nov 2024 (1. NB)" and carry the
  night hours that were actually worked in that month but paid in a later run.
  Their value is attributed to the referenced month and added to any regular
  value for it.
- The same payslip can be reprinted several times in one export; within the
  regular set (and within the NB set) we take the max, so reprints don't double.
- Absence days (Urlaub/Krank) are NOT present in this export format for salaried
  drivers, so they are not returned — they stay manual in the UI.
"""

import re

_MONTHS = {
    'januar': 1, 'februar': 2, 'märz': 3, 'maerz': 3, 'april': 4, 'mai': 5,
    'juni': 6, 'juli': 7, 'august': 8, 'september': 9, 'oktober': 10,
    'november': 11, 'dezember': 12,
    # abbreviations used on Nachberechnung headers
    'jan': 1, 'feb': 2, 'mrz': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'okt': 10, 'nov': 11, 'dez': 12,
}

_MONTH_HDR = re.compile(r'f.r\s+([A-Za-zÄÖÜäöü]+)\s+(\d{4})(?:\s*\((\d+)\.\s*NB\))?')
_NIGHT25 = re.compile(r'203\s+25%\s+Nachtzuschlag\s+Std\s+([\d.,]+)')
_PERS = re.compile(r'\*Pers\.-Nr\.\s*(\d+)\*')
# The Krankenkasse / SV line, e.g. "...KKH... 1658101 1111 2 30". The
# Fehlzeiten (Anw./Urlaub/Krankh./Fehlz.) day counts are appended to it at
# fixed form columns; each is the day count × 10 (e.g. "60" → 6,0 Tage).
_KK_LINE = re.compile(r'\d{7} \d{4} \d \d\d')
# Unbezahlter Urlaub is noted under "Hinweise zur Abrechnung" as an
# interruption with exact dates, e.g. "- Unterbrechung: 21.-30.10.25" followed
# by "Unbezahlter Urlaub". Same-month range "DD.-DD.MM.YY"; several joined by
# "und".
_UNTERBRECHUNG = re.compile(r'Unterbrechung:\s*(.+)')
_UU_RANGE = re.compile(r'(\d{1,2})\.-(\d{1,2})\.(\d{1,2})\.(\d{2})')
# Eintritt / Austritt line in the header, e.g. "  060225 050226" (DDMMYY DDMMYY).
# Austritt may be absent (permanent contract).
_EIN_AUS = re.compile(r'^\s+(\d{6})(?:\s+(\d{6}))?\s*$')


def _ddmmyy(s):
    """DDMMYY → 'YYYY-MM-DD' (assumes 20YY), or None if not a plausible date."""
    if not s or len(s) != 6:
        return None
    dd, mm, yy = int(s[0:2]), int(s[2:4]), int(s[4:6])
    if not (1 <= dd <= 31 and 1 <= mm <= 12):
        return None
    return f"20{yy:02d}-{mm:02d}-{dd:02d}"


def _de_hours(s: str) -> float:
    """German decimal hours → float ("8,50" → 8.5)."""
    try:
        return float(s.strip().replace('.', '').replace(',', '.'))
    except (ValueError, AttributeError):
        return 0.0


def _fehlzeiten(kk_line: str):
    """Extract (Urlaub, Krank) day counts from the Krankenkasse line.

    The counts sit at fixed columns (Urlaub ~70, Krankh. ~76, Fehlz. ~82) and
    are stored as days × 10. Values before column 63 are SV data, not absences.
    """
    urlaub = krank = 0.0
    for m in re.finditer(r'(\d+)(-?)', kk_line):
        col = m.start()
        if col < 63:
            continue
        val = int(m.group(1)) / 10.0
        if m.group(2) == '-':
            val = -val
        if 67 <= col <= 73:
            urlaub = val
        elif 74 <= col <= 80:
            krank = val
        # col >= 81 → Fehlz. Tage (not needed)
    return urlaub, krank


def parse_ans(data):
    """Parse a LohnViewer .ans export.

    ``data`` may be bytes (decoded as latin-1, the DATEV ANSI code page) or str.
    Returns ``{"employees": [{"pers_nr", "name", "months": [...]}]}`` where each
    month is ``{"period": "YYYY-MM", "night25": float, "via_nb": bool}``.
    """
    if isinstance(data, (bytes, bytearray)):
        text = data.decode('latin-1', errors='replace')
    else:
        text = data
    lines = text.split('\n')

    # pers_nr -> {name, reg{period:hours}, nb{period:hours}}
    emp = {}

    def _emp(pers):
        if pers not in emp:
            emp[pers] = {'name': None, 'reg': {}, 'nb': {}, 'url': {}, 'krk': {},
                         'uu': {}, 'ein': set(), 'ausp': {}}
        return emp[pers]

    cur_pers = None
    cur_name = None
    want_name = False

    for i, line in enumerate(lines):
        mp = _PERS.search(line)
        if mp:
            cur_pers = mp.group(1)

        # The employee address block starts right after the @D@...400002 marker;
        # the first following non-empty, non-control line is the name.
        if '@D@000100400002' in line:
            want_name = True
        elif want_name:
            s = line.strip()
            if s and not s.startswith('@') and 'Logistik' not in s:
                cur_name = s
                want_name = False

        mh = _MONTH_HDR.search(line)
        if not mh:
            continue
        mon = _MONTHS.get(mh.group(1).lower())
        if not mon:
            continue
        year = int(mh.group(2))
        is_nb = bool(mh.group(3))
        period = f"{year}-{mon:02d}"

        # Look ahead within this page (until the next month header) for the
        # Krankenkasse line (Fehlzeiten), the 25% Nachtzuschlag line, and any
        # "Unterbrechung … Unbezahlter Urlaub" note.
        n25 = 0.0
        urlaub = krank = 0.0
        got_night = got_kk = got_dates = False
        ein_here = aus_here = None
        uu_here = []  # (period, start_day, end_day)
        for j in range(i + 1, len(lines)):
            if _MONTH_HDR.search(lines[j]):
                break
            if not got_kk and _KK_LINE.search(lines[j]):
                urlaub, krank = _fehlzeiten(lines[j])
                got_kk = True
            if not got_dates:
                dm = _EIN_AUS.match(lines[j])
                if dm and _ddmmyy(dm.group(1)):
                    ein_here = _ddmmyy(dm.group(1))
                    aus_here = _ddmmyy(dm.group(2)) if dm.group(2) else None
                    got_dates = True
            if not got_night:
                nm = _NIGHT25.search(lines[j])
                if nm:
                    n25 = _de_hours(nm.group(1))
                    got_night = True
            um = _UNTERBRECHUNG.search(lines[j])
            if um:
                # Any "Unterbrechung" note is unbezahlter Urlaub. Ranges may wrap
                # onto the next line(s) (joined by "und"), so keep reading while
                # the following lines still carry date ranges.
                texts = [um.group(1)]
                for jj in range(j + 1, min(j + 4, len(lines))):
                    if _UU_RANGE.search(lines[jj]):
                        texts.append(lines[jj])
                    else:
                        break
                for t in texts:
                    for rm in _UU_RANGE.finditer(t):
                        sd, ed, mo, yy = (int(x) for x in rm.groups())
                        if 1 <= mo <= 12:
                            uu_here.append((f"20{yy:02d}-{mo:02d}", sd, ed))

        pers = cur_pers or '?'
        e = _emp(pers)
        if cur_name and not e['name']:
            e['name'] = cur_name
        for pm2, sd, ed in uu_here:
            e['uu'].setdefault(pm2, set()).add((sd, ed))
        if ein_here:
            e['ein'].add(ein_here)
        e['ausp'].setdefault(period, set()).add(aus_here)
        # Always record the month (even at 0 night) so the list mirrors the
        # payslips present; within a bucket keep the largest seen (reprints).
        bucket = e['nb'] if is_nb else e['reg']
        bucket[period] = max(bucket.get(period, 0.0), n25)
        # Urlaub/Krank days: keep the largest seen across regular + NB pages.
        e['url'][period] = max(e['url'].get(period, 0.0), urlaub)
        e['krk'][period] = max(e['krk'].get(period, 0.0), krank)

    employees = []
    for pers, e in emp.items():
        periods = sorted(set(list(e['reg'].keys()) + list(e['nb'].keys()) + list(e['uu'].keys())))
        months = []
        for pm in periods:
            reg = e['reg'].get(pm, 0.0)
            nb = e['nb'].get(pm, 0.0)
            uu = sorted([sd, ed] for sd, ed in e['uu'].get(pm, set()))
            months.append({
                'period': pm,
                'night25': round(reg + nb, 2),
                'via_nb': nb > 0 and reg == 0,
                'urlaub': round(e['url'].get(pm, 0.0), 1),
                'krank': round(e['krk'].get(pm, 0.0), 1),
                'uu': uu,  # unbezahlter Urlaub as [startDay, endDay] ranges
            })
        # Eintritt = earliest start date. Austritt = the end date on the LATEST
        # payslip (a permanent contract shows none), so a superseded befristet
        # end date from an earlier month never truncates later months.
        eintritt = min(e['ein']) if e['ein'] else None
        austritt = None
        if periods:
            last_aus = {a for a in e['ausp'].get(periods[-1], set()) if a}
            austritt = max(last_aus) if last_aus else None
        employees.append({
            'pers_nr': pers, 'name': e['name'] or '', 'months': months,
            'eintritt': eintritt, 'austritt': austritt,
        })

    # Stable order: by name then pers_nr.
    employees.sort(key=lambda x: (x['name'].lower(), x['pers_nr']))
    return {'employees': employees}
