"""Fahrerliste — fill the accountant's monthly driver-list Excel from analyses.

Workflow:
  1. The accountant sends a monthly ``.xlsx`` with all drivers (one sheet per
     ~42-driver print page). The user uploads it here for a period (YYYY-MM).
  2. While analysing each driver, the frontend posts that driver's monthly
     numbers (per-day hours, 25 %, 40 %, VMA, AZ, Ur/Kr) to ``/fill``; we find
     the driver's row by name and write the cells, preserving everything else.
  3. The user downloads the filled workbook any time.

No data is recomputed here — the analysis layer provides the numbers; this
module only does name matching and cell writing on the uploaded file.
"""

from __future__ import annotations

import logging
import os
import re
import unicodedata
from datetime import datetime

from flask import Blueprint, jsonify, request, send_file

from auth.decorators import login_required
from auth.helpers import _log_activity
from config import DATABASE_FILE

try:
    import openpyxl  # noqa: F401
    _HAS_OPENPYXL = True
except ImportError:  # pragma: no cover
    _HAS_OPENPYXL = False

_log = logging.getLogger(__name__)
bp = Blueprint('fahrerliste', __name__)

_STORE_DIR = os.path.join(os.path.dirname(DATABASE_FILE) or '.', 'fahrerliste')

# Day-cell markers we recognise / write straight through.
_ABSENCE_MARKERS = {'UR', 'KR', 'F', 'X'}

# Words inside a name cell that are notes, not part of the name.
_NAME_STOPWORDS = {
    'std', 'std.', 'hof', 'ross', 'a', 'n', 'b', 'h', 'b/h', 'dp', 'ro',
    'vma', 'gfb', 'tag', 'na', 'inkl', 'sa', 'so', 'incl', 'mit', 'ohne',
}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _period_ok(period: str) -> bool:
    return bool(period) and bool(re.match(r'^\d{4}-\d{2}$', period))


def _store_path(period: str) -> str:
    return os.path.join(_STORE_DIR, f'{period}.xlsx')


def _ascii_fold(s: str) -> str:
    return ''.join(
        c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)
    )


def _name_tokens(text) -> frozenset:
    """Token bag from a name cell — order- and case-independent.

    Takes the part before the first digit / ``%`` (the rest is notes),
    drops obvious note words, lowercases and strips diacritics.
    """
    if not text:
        return frozenset()
    s = str(text)
    s = re.split(r'[\d%]', s, 1)[0]
    s = _ascii_fold(s).lower()
    toks = [t for t in re.split(r'[^a-z]+', s) if len(t) >= 2 and t not in _NAME_STOPWORDS]
    return frozenset(toks)


def _hm_to_minutes(value) -> int | None:
    if value is None:
        return None
    m = re.match(r'^\s*(\d+):([0-5]?\d)\s*$', str(value))
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


# ---------------------------------------------------------------------------
# workbook parsing
# ---------------------------------------------------------------------------

def _scan_sheet(ws):
    """Locate the day-header row and the special columns on one sheet.

    Returns ``None`` when the sheet doesn't look like a driver list, else::

        {
          "day_row": int,            # 1-based row with the day numbers
          "day_cols": {day:int -> col:int},
          "name_col": int,
          "n25_col"/"n40_col"/"ue_col"/"ur_col"/"kr_col"/"vma_col"/"az_col": int|None,
        }
    """
    max_r = min(ws.max_row, 6)
    max_c = ws.max_column
    best = None
    for r in range(1, max_r + 1):
        day_cols = {}
        markers = {}
        for c in range(1, max_c + 1):
            v = ws.cell(row=r, column=c).value
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                iv = int(v)
                if 1 <= iv <= 31 and float(v) == iv:
                    day_cols[iv] = c
                elif abs(float(v) - 0.25) < 1e-6:
                    markers['n25_col'] = c
                elif abs(float(v) - 0.4) < 1e-6:
                    markers['n40_col'] = c
            elif isinstance(v, str):
                t = v.strip().lower()
                if t in ('ü', 'u', 'ue', 'überstunden'):
                    markers['ue_col'] = c
                elif t == 'ur':
                    markers['ur_col'] = c
                elif t == 'kr':
                    markers['kr_col'] = c
                elif t == 'vma':
                    markers['vma_col'] = c
                elif t == 'az':
                    markers['az_col'] = c
        if len(day_cols) >= 10 and best is None:
            best = (r, day_cols, markers)
    if not best:
        return None
    day_row, day_cols, markers = best

    # Name column: among A..(first day col - 1), the one with the most
    # name-ish strings in the rows below the header.
    first_day_col = min(day_cols.values())
    name_col, name_score = None, -1
    for c in range(1, first_day_col):
        score = 0
        for r in range(day_row + 1, min(ws.max_row, day_row + 60) + 1):
            v = ws.cell(row=r, column=c).value
            if isinstance(v, str) and len(v.strip()) > 4 and re.search(r'[A-Za-zÀ-ž]{3,}', v):
                score += 1
        if score > name_score:
            name_score, name_col = score, c
    if name_col is None or name_score <= 0:
        return None

    return {
        'day_row': day_row,
        'day_cols': day_cols,
        'name_col': name_col,
        'n25_col': markers.get('n25_col'),
        'n40_col': markers.get('n40_col'),
        'ue_col': markers.get('ue_col'),
        'ur_col': markers.get('ur_col'),
        'kr_col': markers.get('kr_col'),
        'vma_col': markers.get('vma_col'),
        'az_col': markers.get('az_col'),
    }


def _index_workbook(wb):
    """Return ``(sheets_meta, rows)`` where rows is a list of dicts:
    ``{sheet, row, name, tokens, meta}`` for every driver row found.
    """
    sheets_meta = {}
    rows = []
    for sn in wb.sheetnames:
        ws = wb[sn]
        meta = _scan_sheet(ws)
        if not meta:
            continue
        sheets_meta[sn] = meta
        last = min(ws.max_row, meta['day_row'] + 200)
        for r in range(meta['day_row'] + 1, last + 1):
            nv = ws.cell(row=r, column=meta['name_col']).value
            if not isinstance(nv, str) or len(nv.strip()) <= 3:
                continue
            toks = _name_tokens(nv)
            if not toks:
                continue
            rows.append({'sheet': sn, 'row': r, 'name': nv.strip(), 'tokens': toks, 'meta': meta})
    return sheets_meta, rows


def _match_row(rows, driver_name):
    """Match ``driver_name`` to driver row(s) by name-token overlap.

    Returns ``(target_rows, candidate_names)``. ``target_rows`` is a list —
    the same driver can appear on several sheets (e.g. a per-page sheet plus
    an overview), and all matching rows get filled. ``target_rows`` is empty
    when nothing matches well enough or when distinct drivers tie (then
    ``candidate_names`` lists the colliding cell texts).
    """
    want = _name_tokens(driver_name)
    if not want:
        return [], []
    scored = []
    for r in rows:
        common = want & r['tokens']
        if not common:
            continue
        scored.append((len(common) / len(want), r))
    if not scored:
        return [], []
    best_cov = max(c for c, _ in scored)
    if best_cov < 0.5:
        return [], [r['name'] for c, r in scored if c == best_cov][:5]
    top = [r for c, r in scored if abs(c - best_cov) < 1e-9]
    distinct = {r['tokens'] for r in top}
    if len(distinct) > 1:
        return [], [r['name'] for r in top][:5]
    return top, []


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------

@bp.route('/api/fahrerliste/upload', methods=['POST'])
@login_required
def fahrerliste_upload():
    if not _HAS_OPENPYXL:
        return jsonify({'error': 'openpyxl nie jest zainstalowany na serwerze'}), 500
    period = (request.form.get('period') or '').strip()
    if not _period_ok(period):
        return jsonify({'error': 'period (YYYY-MM) wymagany'}), 400
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400
    f = request.files['file']
    if not f.filename or not f.filename.lower().endswith(('.xlsx', '.xlsm')):
        return jsonify({'error': 'Wymagany plik .xlsx'}), 400
    os.makedirs(_STORE_DIR, exist_ok=True)
    path = _store_path(period)
    f.save(path)
    try:
        wb = openpyxl.load_workbook(path, data_only=False)
    except Exception as exc:
        try:
            os.unlink(path)
        except OSError:
            pass
        return jsonify({'error': f'Nie można odczytać pliku: {exc}'}), 400
    _sheets_meta, rows = _index_workbook(wb)
    wb.close()
    _log_activity('fahrerliste_upload', f'{period} — {len(rows)} kierowców')
    return jsonify({
        'period': period,
        'count': len(rows),
        'drivers': sorted(r['name'] for r in rows),
        'sheets': sorted({r['sheet'] for r in rows}),
    })


@bp.route('/api/fahrerliste/status', methods=['GET'])
@login_required
def fahrerliste_status():
    if not _HAS_OPENPYXL:
        return jsonify({'exists': False, 'error': 'openpyxl nie jest zainstalowany'}), 200
    period = (request.args.get('period') or '').strip()
    if not _period_ok(period):
        return jsonify({'error': 'period (YYYY-MM) wymagany'}), 400
    path = _store_path(period)
    if not os.path.exists(path):
        return jsonify({'exists': False, 'period': period})
    try:
        wb = openpyxl.load_workbook(path, data_only=False)
        _m, rows = _index_workbook(wb)
        wb.close()
    except Exception as exc:
        return jsonify({'exists': True, 'period': period, 'error': str(exc)})
    return jsonify({
        'exists': True,
        'period': period,
        'count': len(rows),
        'drivers': sorted(r['name'] for r in rows),
        'sheets': sorted({r['sheet'] for r in rows}),
        'updated_at': datetime.utcfromtimestamp(os.path.getmtime(path)).isoformat() + 'Z',
    })


@bp.route('/api/fahrerliste/fill', methods=['POST'])
@login_required
def fahrerliste_fill():
    if not _HAS_OPENPYXL:
        return jsonify({'error': 'openpyxl nie jest zainstalowany na serwerze'}), 500
    data = request.get_json(silent=True) or {}
    period = (data.get('period') or '').strip()
    driver_name = (data.get('driver_name') or '').strip()
    if not _period_ok(period):
        return jsonify({'error': 'period (YYYY-MM) wymagany'}), 400
    if not driver_name:
        return jsonify({'error': 'driver_name wymagany'}), 400
    path = _store_path(period)
    if not os.path.exists(path):
        return jsonify({'error': f'Brak wgranej listy dla {period}'}), 404

    days = data.get('days') or {}            # {"1": "8:56", ...}
    absences = data.get('absences') or {}    # {"2": "Ur", ...}
    n25 = data.get('n25')                     # number or "X,XX" string
    n40 = data.get('n40')
    vma = data.get('vma')                     # int
    az = data.get('az')                       # "H:MM"
    ur = data.get('ur')                       # int (vacation days)
    kr = data.get('kr')                       # int (sick days)

    try:
        wb = openpyxl.load_workbook(path, data_only=False)
    except Exception as exc:
        return jsonify({'error': f'Nie można odczytać listy: {exc}'}), 500
    _m, rows = _index_workbook(wb)
    target_rows, candidates = _match_row(rows, driver_name)
    if not target_rows:
        wb.close()
        msg = f'Nie znaleziono kierowcy „{driver_name}" w liście' + (
            f' — podobne wpisy: {", ".join(candidates)}' if candidates else ''
        )
        return jsonify({'error': msg, 'not_found': True, 'candidates': candidates}), 404

    def _num_str(v):
        if v is None or v == '':
            return None
        if isinstance(v, str):
            return v.replace('.', ',')
        return f'{float(v):.2f}'.replace('.', ',')

    def _fill_row(ws, r, meta):
        # Day cells: clear the whole row first, then write this month's
        # values, so a re-run produces a clean, consistent row.
        for col in meta['day_cols'].values():
            ws.cell(row=r, column=col, value=None)
        for d, col in meta['day_cols'].items():
            d_str = str(d)
            marker = absences.get(d_str)
            if marker and str(marker).strip().upper() in _ABSENCE_MARKERS:
                ws.cell(row=r, column=col, value=str(marker).strip())
                continue
            val = days.get(d_str)
            if val not in (None, ''):
                ws.cell(row=r, column=col, value=str(val))

        def _set(col, value):
            if col and value is not None and value != '':
                ws.cell(row=r, column=col, value=value)

        _set(meta.get('n25_col'), _num_str(n25))
        _set(meta.get('n40_col'), _num_str(n40))
        if meta.get('vma_col') and vma not in (None, ''):
            try:
                ws.cell(row=r, column=meta['vma_col'], value=int(vma))
            except (TypeError, ValueError):
                ws.cell(row=r, column=meta['vma_col'], value=vma)
        _set(meta.get('az_col'), str(az) if az not in (None, '') else None)
        for key, val in (('ur_col', ur), ('kr_col', kr)):
            col = meta.get(key)
            if col and val not in (None, '', 0):
                try:
                    ws.cell(row=r, column=col, value=int(val))
                except (TypeError, ValueError):
                    pass

    filled = []
    for ri in target_rows:
        _fill_row(wb[ri['sheet']], ri['row'], ri['meta'])
        filled.append({'sheet': ri['sheet'], 'row': ri['row']})

    try:
        wb.save(path)
    except Exception as exc:
        wb.close()
        return jsonify({'error': f'Nie można zapisać listy: {exc}'}), 500
    wb.close()
    matched_name = target_rows[0]['name']
    _log_activity('fahrerliste_fill', f'{period} — {driver_name} → {len(filled)} rows')
    return jsonify({'ok': True, 'filled': filled, 'matched_name': matched_name})


@bp.route('/api/fahrerliste/download', methods=['GET'])
@login_required
def fahrerliste_download():
    period = (request.args.get('period') or '').strip()
    if not _period_ok(period):
        return jsonify({'error': 'period (YYYY-MM) wymagany'}), 400
    path = _store_path(period)
    if not os.path.exists(path):
        return jsonify({'error': f'Brak wgranej listy dla {period}'}), 404
    return send_file(
        path, as_attachment=True,
        download_name=f'fahrerliste_{period}.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
