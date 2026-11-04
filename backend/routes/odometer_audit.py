"""Year-end odometer audit (Km-Stand zum Jahresende) from driver-card files.

    GET  /api/odometer-audit/summary          counts, years available, scan state
    POST /api/odometer-audit/scan             {force?, refresh?} start background scan of the archive
    POST /api/odometer-audit/scan/cancel
    GET  /api/odometer-audit/scan/status
    POST /api/odometer-audit/upload           multipart files[] (.ddd or .zip), keep=1 stores copies in the audit archive
    GET  /api/odometer-audit/report?year=     per-vehicle km-stand on 31.12
    GET  /api/odometer-audit/vehicle?plate=&year=   records around the year end
    GET  /api/odometer-audit/files?errors=1
    POST /api/odometer-audit/reset            admin: drop all scanned data
"""

from datetime import datetime

from flask import Blueprint, jsonify, request

from auth.decorators import admin_required, permission_required
from auth.helpers import _log_activity
from services import odometer_audit as svc

bp = Blueprint('odometer_audit', __name__)


def _year_arg():
    try:
        y = int(request.args.get('year') or datetime.now().year - 1)
    except ValueError:
        y = datetime.now().year - 1
    return max(2000, min(2100, y))


@bp.route('/api/odometer-audit/summary')
@permission_required('vehicles')
def api_summary():
    return jsonify(svc.summary())


@bp.route('/api/odometer-audit/scan', methods=['POST'])
@permission_required('vehicles')
def api_scan():
    data = request.get_json(silent=True) or {}
    started = svc.start_scan(force=bool(data.get('force')), refresh_list=data.get('refresh', True) is not False)
    if started:
        _log_activity('odometer_audit_scan', 'force' if data.get('force') else '')
    return jsonify({'started': started, 'status': svc.scan_status()})


@bp.route('/api/odometer-audit/scan/cancel', methods=['POST'])
@permission_required('vehicles')
def api_scan_cancel():
    svc.cancel_scan()
    return jsonify({'ok': True, 'status': svc.scan_status()})


@bp.route('/api/odometer-audit/scan/status')
@permission_required('vehicles')
def api_scan_status():
    return jsonify(svc.scan_status())


@bp.route('/api/odometer-audit/upload', methods=['POST'])
@permission_required('vehicles')
def api_upload():
    files = request.files.getlist('files') or request.files.getlist('file')
    if not files:
        return jsonify({'error': 'Brak plików / Keine Dateien'}), 400
    keep = (request.form.get('keep') or '1') != '0'
    results = []
    for f in files[:500]:
        results.extend(svc.ingest_upload(f.filename or 'upload.ddd', f.read(), keep=keep))
    counts = {
        'new': sum(1 for r in results if r.get('status') == 'new'),
        'skipped': sum(1 for r in results if r.get('status') == 'skipped'),
        'error': sum(1 for r in results if r.get('status') == 'error'),
    }
    _log_activity('odometer_audit_upload', f"{len(results)} files ({counts['new']} new, {counts['skipped']} skipped, {counts['error']} errors)")
    return jsonify({'results': results, 'counts': counts, 'new_records': sum(r.get('new', 0) for r in results)})


@bp.route('/api/odometer-audit/report')
@permission_required('vehicles')
def api_report():
    return jsonify(svc.year_report(_year_arg()))


@bp.route('/api/odometer-audit/vehicle')
@permission_required('vehicles')
def api_vehicle():
    plate = svc.normalize_plate(request.args.get('plate') or '')
    if not plate:
        return jsonify({'error': 'plate required'}), 400
    try:
        days = max(7, min(400, int(request.args.get('days') or 45)))
    except ValueError:
        days = 45
    return jsonify(svc.vehicle_timeline(plate, _year_arg(), days))


@bp.route('/api/odometer-audit/files')
@permission_required('vehicles')
def api_files():
    try:
        limit = max(1, min(2000, int(request.args.get('limit') or 200)))
    except ValueError:
        limit = 200
    return jsonify({'files': svc.list_files(limit, request.args.get('errors') == '1')})


@bp.route('/api/odometer-audit/reset', methods=['POST'])
@admin_required
def api_reset():
    svc.reset_all()
    _log_activity('odometer_audit_reset')
    return jsonify({'ok': True})
