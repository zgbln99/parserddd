import csv
import io
import os
from datetime import datetime

from flask import Blueprint, request, jsonify, Response

from auth.decorators import login_required
from auth.helpers import _log_activity, _get_db
from config import COMPANY_LOGO_PATH

bp = Blueprint('export', __name__)


@bp.route('/api/export/datev-batch', methods=['POST'])
@login_required
def api_export_datev_batch():
    """Generate a combined DATEV CSV for multiple drivers at once.

    Accepts {period: "YYYY-MM", drivers: [{driver_name, card_number, summary, shifts}, ...]}
    Returns a single CSV file with all drivers.
    """
    payload = request.json or {}
    period = payload.get('period', '')
    driver_list = payload.get('drivers', [])
    if not driver_list:
        return jsonify({'error': 'No drivers data'}), 400

    year_str = period[:4] if len(period) >= 4 else ''
    month_str = period[5:7] if len(period) >= 7 else ''

    conn = _get_db()

    def fmt_de(val):
        return f"{val:.2f}".replace('.', ',')

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';', quoting=csv.QUOTE_ALL)

    # Summary header
    writer.writerow([
        'Personalnr', 'Name', 'Monat', 'Jahr',
        'Arbeitsstunden', 'Nacht 25%', 'Nacht 40%',
        'Überstunden', 'Urlaub', 'Krank',
        'VMA Tage', 'VMA Betrag (EUR)',
        'Schichten gesamt',
    ])

    for drv in driver_list:
        driver_name = drv.get('driver_name', '')
        card_number = drv.get('card_number', '')
        summary = drv.get('summary', {})

        dcfg = conn.execute('SELECT * FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()
        dcfg = dict(dcfg) if dcfg else {}

        personal_nr = dcfg.get('personal_nr', '') or card_number
        double_diet = bool(dcfg.get('double_diet', 0))
        VMA_RATE = float(dcfg.get('diet_rate', 14.0))

        total_work_h = summary.get('total_work_minutes', 0) / 60
        n25_h = summary.get('night_25_minutes', 0) / 60
        n40_h = summary.get('night_40_minutes', 0) / 60
        diet_count = summary.get('diet_count', 0)
        # Double diet = two separate allowances per day (14€ + 14€), not double the count
        vma_per_day = VMA_RATE * 2 if double_diet else VMA_RATE
        vma_amount = diet_count * vma_per_day

        writer.writerow([
            personal_nr,
            driver_name,
            month_str,
            year_str,
            fmt_de(total_work_h),
            fmt_de(n25_h),
            fmt_de(n40_h),
            '',  # Überstunden
            '',  # Urlaub
            '',  # Krank
            str(diet_count),
            fmt_de(vma_amount),
            str(summary.get('total_shifts', 0)),
        ])

    # Blank line separator
    writer.writerow([])

    # Detail section for each driver
    for drv in driver_list:
        driver_name = drv.get('driver_name', '')
        shifts = drv.get('shifts', [])
        if not shifts:
            continue

        writer.writerow([f'--- {driver_name} ---'])
        writer.writerow([
            'Datum', 'Wochentag', 'Start', 'Ende',
            'Arbeitszeit', 'Fahrzeit', 'Pause',
            'Nacht 25%', 'Nacht 40%', 'VMA', 'Fahrzeug',
        ])
        for s in shifts:
            writer.writerow([
                s.get('shift_date', ''),
                s.get('weekday', ''),
                s.get('shift_start', '').split(' ')[-1] if ' ' in s.get('shift_start', '') else s.get('shift_start', ''),
                s.get('shift_end', '').split(' ')[-1] if ' ' in s.get('shift_end', '') else s.get('shift_end', ''),
                fmt_de(s.get('work_minutes', 0) / 60),
                fmt_de(s.get('driving_minutes', 0) / 60),
                fmt_de(s.get('break_minutes', 0) / 60),
                fmt_de(s.get('night_25_minutes', 0) / 60),
                fmt_de(s.get('night_40_minutes', 0) / 60),
                'JA' if s.get('has_diet') else '',
                ', '.join(s.get('vehicles', [])),
            ])
        writer.writerow([])

    conn.close()
    csv_bytes = output.getvalue().encode('utf-8-sig')
    filename = f"DATEV_Alle_{period or datetime.now().strftime('%Y-%m')}.csv"
    _log_activity('export_datev_batch', f"{period} – {len(driver_list)} drivers")
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@bp.route('/api/export/csv', methods=['POST'])
@login_required
def api_export_csv():
    """Generate CSV from shift data and return it."""
    payload = request.json or {}
    driver_name = payload.get('driver_name', 'kierowca')
    shifts = payload.get('shifts', [])

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow([
        'Dzień', 'Start', 'Koniec', 'Czas trwania', 'Pojazd', 'Jazda', 'Praca',
        'Przerwy', 'Czas pracy', 'Nocne 25%', 'Nocne 40%', 'Dieta',
    ])
    for s in shifts:
        writer.writerow([
            s.get('weekday', ''),
            s.get('shift_start', ''),
            s.get('shift_end', ''),
            s.get('duration_hm', ''),
            ', '.join(s.get('vehicles', [])),
            s.get('driving_hm', ''),
            s.get('work_only_hm', ''),
            s.get('break_hm', ''),
            s.get('work_hm', ''),
            f"{s.get('night_25_minutes', 0) / 60:.2f}",
            f"{s.get('night_40_minutes', 0) / 60:.2f}",
            'TAK' if s.get('has_diet') else 'NIE',
        ])

    csv_bytes = output.getvalue().encode('utf-8-sig')
    safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'kierowca'
    filename = f"{safe_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@bp.route('/api/export/pdf', methods=['POST'])
@login_required
def api_export_pdf():
    """Generate a PDF report from analysis data."""
    payload = request.json or {}
    driver_name = payload.get('driver_name', 'Kierowca')
    card_number = payload.get('card_number', '')
    summary = payload.get('summary', {})
    shifts = payload.get('shifts', [])

    # Company logo (optional)
    logo_html = ''
    if COMPANY_LOGO_PATH and os.path.exists(COMPANY_LOGO_PATH):
        import base64
        with open(COMPANY_LOGO_PATH, 'rb') as lf:
            logo_b64 = base64.b64encode(lf.read()).decode()
        ext_logo = COMPANY_LOGO_PATH.rsplit('.', 1)[-1].lower()
        mime = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'svg': 'image/svg+xml'}.get(ext_logo, 'image/png')
        logo_html = f'<img src="data:{mime};base64,{logo_b64}" style="max-height:60px;margin-bottom:8px;" />'

    # Build simple HTML-based PDF using basic HTML tables
    html_parts = [
        '<!DOCTYPE html><html><head><meta charset="utf-8">',
        '<style>',
        'body{font-family:Arial,sans-serif;font-size:11px;margin:20px;}',
        '.header{display:flex;align-items:center;gap:16px;margin-bottom:12px;}',
        '.header img{max-height:60px;}',
        'h1{font-size:18px;margin-bottom:4px;}',
        'h2{font-size:14px;color:#555;margin:16px 0 8px;}',
        '.meta{color:#666;font-size:10px;margin-bottom:16px;}',
        '.grid{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;}',
        '.card{border:1px solid #ddd;border-radius:8px;padding:10px 16px;text-align:center;min-width:120px;}',
        '.card .label{font-size:9px;text-transform:uppercase;font-weight:bold;color:#888;letter-spacing:0.5px;}',
        '.card .val{font-size:18px;font-weight:bold;margin-top:2px;}',
        '.highlight{border-color:#4f46e5;background:#f5f3ff;}',
        'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10px;}',
        'th{background:#f3f4f6;border:1px solid #ddd;padding:5px 8px;text-align:left;font-size:9px;text-transform:uppercase;}',
        'td{border:1px solid #eee;padding:4px 8px;}',
        'tr:nth-child(even){background:#fafafa;}',
        '.diet-yes{color:#16a34a;font-weight:bold;}',
        '.footer{margin-top:20px;font-size:9px;color:#999;text-align:center;}',
        '</style></head><body>',
        f'<div class="header">{logo_html}<div><h1>{driver_name}</h1>' if logo_html else f'<h1>{driver_name}</h1>',
        f'<div class="meta">{card_number}</div></div></div>' if logo_html and card_number else (f'<div class="meta">{card_number}</div>' if card_number else ('</div></div>' if logo_html else '')),
        '<h2>Podsumowanie</h2>',
        '<div class="grid">',
        f'<div class="card highlight"><div class="label">Czas pracy</div><div class="val">{summary.get("total_work_hm", "-")}</div></div>',
        f'<div class="card highlight"><div class="label">Nocne 25%</div><div class="val">{summary.get("night_25_minutes", 0) / 60:.2f}h ({summary.get("night_25_hm", "-")})</div></div>',
        f'<div class="card highlight"><div class="label">Nocne 40%</div><div class="val">{summary.get("night_40_minutes", 0) / 60:.2f}h ({summary.get("night_40_hm", "-")})</div></div>',
        f'<div class="card highlight"><div class="label">Diety</div><div class="val">{summary.get("diet_count", 0)}</div></div>',
        '</div>',
        '<div class="grid">',
        f'<div class="card"><div class="label">Jazda</div><div class="val">{summary.get("total_driving_hm", "-")}</div></div>',
        f'<div class="card"><div class="label">Przerwy</div><div class="val">{summary.get("total_break_hm", "-")}</div></div>',
        f'<div class="card"><div class="label">Łącznie zmian</div><div class="val">{summary.get("total_shifts", 0)}</div></div>',
        '</div>',
        '<h2>Zmiany</h2>',
        '<table><thead><tr>',
        '<th>Dzień</th><th>Start</th><th>Koniec</th><th>Czas</th><th>Pojazd</th>',
        '<th>Jazda</th><th>Praca</th><th>Przerwy</th>',
        '<th>Nocne 25%</th><th>Nocne 40%</th><th>Dieta</th>',
        '</tr></thead><tbody>',
    ]
    weekend_style = ' style="background:#fef2f2;"'
    for s in shifts:
        n25 = f"{s.get('night_25_minutes', 0) / 60:.2f}"
        n40 = f"{s.get('night_40_minutes', 0) / 60:.2f}"
        diet = '<span class="diet-yes">TAK</span>' if s.get('has_diet') else 'NIE'
        wd = s.get('weekday', '')
        is_weekend = wd in ('So', 'Nd', 'Sa', 'Su')
        row_style = weekend_style if is_weekend else ''
        html_parts.append(
            f'<tr{row_style}><td><b>{wd}</b></td><td>{s.get("shift_start","")}</td><td>{s.get("shift_end","")}</td>'
            f'<td><b>{s.get("duration_hm","")}</b></td><td>{", ".join(s.get("vehicles",[]))}</td>'
            f'<td>{s.get("driving_hm","")}</td><td>{s.get("work_only_hm","")}</td>'
            f'<td>{s.get("break_hm","")}</td><td>{n25}</td><td>{n40}</td><td>{diet}</td></tr>'
        )
    html_parts.append('</tbody></table>')
    html_parts.append(f'<div class="footer">LTS Logistik GmbH — Tachoprüfung — wygenerowano {datetime.now().strftime("%Y-%m-%d %H:%M")}</div>')
    html_parts.append('</body></html>')

    html_content = '\n'.join(html_parts)

    # Try weasyprint first, fall back to HTML download
    try:
        from weasyprint import HTML as WeasyHTML
        pdf_bytes = WeasyHTML(string=html_content).write_pdf()
        content_type = 'application/pdf'
        ext = 'pdf'
    except ImportError:
        # Fallback: return HTML file that can be printed to PDF from browser
        pdf_bytes = html_content.encode('utf-8')
        content_type = 'text/html'
        ext = 'html'

    safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'kierowca'
    filename = f"{safe_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{ext}"
    return Response(
        pdf_bytes,
        mimetype=content_type,
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@bp.route('/api/export/datev', methods=['POST'])
@login_required
def api_export_datev():
    """Generate DATEV-compatible CSV from shift analysis data."""
    payload = request.json or {}
    driver_name = payload.get('driver_name', 'Fahrer')
    card_number = payload.get('card_number', '')
    summary = payload.get('summary', {})
    shifts = payload.get('shifts', [])
    period = payload.get('period', '')  # YYYY-MM

    # Load driver config from DB
    conn = _get_db()
    dcfg = conn.execute('SELECT * FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()
    conn.close()
    dcfg = dict(dcfg) if dcfg else {}

    personal_nr = dcfg.get('personal_nr', '') or card_number
    double_diet = bool(dcfg.get('double_diet', 0))
    VMA_RATE = float(dcfg.get('diet_rate', 14.0))

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';', quoting=csv.QUOTE_ALL)

    # DATEV-compatible header
    writer.writerow([
        'Personalnr', 'Name', 'Monat', 'Jahr',
        'Arbeitsstunden', 'Nacht 25%', 'Nacht 40%',
        'Überstunden', 'Urlaub', 'Krank',
        'VMA Tage', 'VMA Betrag (EUR)',
        'Schichten gesamt',
    ])

    # Determine period
    year_str = ''
    month_str = ''
    if period:
        parts = period.split('-')
        year_str = parts[0] if len(parts) > 0 else ''
        month_str = parts[1] if len(parts) > 1 else ''
    elif shifts:
        first_date = shifts[0].get('shift_date', '')
        if len(first_date) >= 7:
            year_str = first_date[:4]
            month_str = first_date[5:7]

    # Format numbers German style
    def fmt_de(val):
        return f"{val:.2f}".replace('.', ',')

    total_work_h = summary.get('total_work_minutes', 0) / 60
    n25_h = summary.get('night_25_minutes', 0) / 60
    n40_h = summary.get('night_40_minutes', 0) / 60
    diet_count = summary.get('diet_count', 0)
    # Double diet = two separate allowances per day (14€ + 14€), not double the count
    vma_per_day = VMA_RATE * 2 if double_diet else VMA_RATE
    vma_amount = diet_count * vma_per_day

    writer.writerow([
        personal_nr,
        driver_name,
        month_str,
        year_str,
        fmt_de(total_work_h),
        fmt_de(n25_h),
        fmt_de(n40_h),
        '',  # Überstunden
        '',  # Urlaub
        '',  # Krank
        str(diet_count),
        fmt_de(vma_amount),
        str(summary.get('total_shifts', 0)),
    ])

    # Detail rows per shift
    writer.writerow([])
    writer.writerow([
        'Datum', 'Wochentag', 'Start', 'Ende',
        'Arbeitszeit', 'Fahrzeit', 'Pause',
        'Nacht 25%', 'Nacht 40%', 'VMA', 'Fahrzeug',
    ])
    for s in shifts:
        writer.writerow([
            s.get('shift_date', ''),
            s.get('weekday', ''),
            s.get('shift_start', ''),
            s.get('shift_end', ''),
            fmt_de(s.get('work_minutes', 0) / 60),
            fmt_de(s.get('driving_minutes', 0) / 60),
            fmt_de(s.get('break_minutes', 0) / 60),
            fmt_de(s.get('night_25_minutes', 0) / 60),
            fmt_de(s.get('night_40_minutes', 0) / 60),
            'JA' if s.get('has_diet') else '',
            ', '.join(s.get('vehicles', [])),
        ])

    csv_bytes = output.getvalue().encode('utf-8-sig')
    safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'fahrer'
    filename = f"DATEV_{safe_name}_{period or datetime.now().strftime('%Y-%m')}.csv"
    _log_activity('export_datev', f"{driver_name} {period}")
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )
