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


def _de_hours(s: str) -> float:
    """German decimal hours → float ("8,50" → 8.5)."""
    try:
        return float(s.strip().replace('.', '').replace(',', '.'))
    except (ValueError, AttributeError):
        return 0.0


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
            emp[pers] = {'name': None, 'reg': {}, 'nb': {}}
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
        # 25% Nachtzuschlag line.
        n25 = 0.0
        for j in range(i + 1, len(lines)):
            if _MONTH_HDR.search(lines[j]):
                break
            nm = _NIGHT25.search(lines[j])
            if nm:
                n25 = _de_hours(nm.group(1))
                break

        pers = cur_pers or '?'
        e = _emp(pers)
        if cur_name and not e['name']:
            e['name'] = cur_name
        # Always record the month (even at 0 night) so the list mirrors the
        # payslips present; within a bucket keep the largest seen (reprints).
        bucket = e['nb'] if is_nb else e['reg']
        bucket[period] = max(bucket.get(period, 0.0), n25)

    employees = []
    for pers, e in emp.items():
        periods = sorted(set(list(e['reg'].keys()) + list(e['nb'].keys())))
        months = []
        for pm in periods:
            reg = e['reg'].get(pm, 0.0)
            nb = e['nb'].get(pm, 0.0)
            months.append({
                'period': pm,
                'night25': round(reg + nb, 2),
                'via_nb': nb > 0 and reg == 0,
            })
        employees.append({'pers_nr': pers, 'name': e['name'] or '', 'months': months})

    # Stable order: by name then pers_nr.
    employees.sort(key=lambda x: (x['name'].lower(), x['pers_nr']))
    return {'employees': employees}
