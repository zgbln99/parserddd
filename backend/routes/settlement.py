"""
Settlement Blueprint — monthly settlement, driver-km, driver-monthly days.
"""

import json as _json
import os
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from flask import Blueprint, request, jsonify

from auth.decorators import login_required
from auth.helpers import _log_activity, _get_db, _load_config
from config import logger
from core.constants import UTC
from core.utils import minutes_to_hm
from core.parsers import parse_ddd_auto
from core.extractors import get_driver_info, get_vehicle_records
from core.analysis import analyze_card
from services.dropbox_service import (
    get_server_dropbox_client, build_drivers_data, load_portal_cache,
)

bp = Blueprint('settlement', __name__)


@bp.route('/api/settlement', methods=['POST'])
@login_required
def api_settlement():
    """Analyze all drivers for a given month."""
    try:
        payload = request.get_json(silent=True) or {}
        period = payload.get('period', '')
        if not period or not re.match(r'^\d{4}-\d{2}$', period):
            return jsonify({'error': 'period (YYYY-MM) required'}), 400

        cached = load_portal_cache()
        if cached:
            drivers_data = cached
        else:
            dbx = get_server_dropbox_client()
            if not dbx:
                return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500
            sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
            drivers_data = build_drivers_data(dbx, sync_folder)

        conn = _get_db()
        all_configs = {}
        for row in conn.execute('SELECT * FROM driver_config').fetchall():
            all_configs[row['card_number']] = dict(row)
        conn.close()

        tasks = []
        for driver in drivers_data:
            files = driver.get('files', [])
            if not files:
                continue
            file_path = files[0].get('path', '')
            if not file_path:
                continue
            tasks.append({
                'driver_name': driver.get('name', ''),
                'card_number': driver.get('card_number', ''),
                'file_path': file_path,
            })

        def process_driver(task):
            dbx_thread = get_server_dropbox_client()
            if not dbx_thread:
                return None
            driver_name = task['driver_name']
            card_number = task['card_number']
            file_path = task['file_path']
            try:
                _metadata, response = dbx_thread.files_download(file_path)
                with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
                    tmp.write(response.content)
                    tmp_path = tmp.name
                data = parse_ddd_auto(tmp_path, config_loader=_load_config)
                # Look up per-driver analysis flags
                _flags = {'night_40_check_midnight': True, 'pause_cap_enabled': False}
                try:
                    _di = get_driver_info(data)
                    _cn = _di.get('card_number', '')
                    if _cn:
                        _conn = _get_db()
                        _row = _conn.execute('SELECT night_40_enabled, pause_cap_enabled FROM driver_config WHERE card_number = ?', (_cn,)).fetchone()
                        _conn.close()
                        if _row:
                            _flags['night_40_check_midnight'] = bool(_row['night_40_enabled'])
                            _flags['pause_cap_enabled'] = bool(_row['pause_cap_enabled'])
                except Exception:
                    pass
                analysis = analyze_card(data, config_loader=_load_config, night_40_check_midnight=_flags['night_40_check_midnight'], pause_cap_enabled=_flags['pause_cap_enabled'])
                os.unlink(tmp_path)

                month_shifts = [sh for sh in analysis.get('shift_details', [])
                               if sh.get('shift_date', '')[:7] == period]
                if not month_shifts:
                    return None

                total_work = sum(s.get('work_minutes', 0) for s in month_shifts)
                total_driving = sum(s.get('driving_minutes', 0) for s in month_shifts)
                total_break = sum(s.get('break_minutes', 0) for s in month_shifts)
                total_avail = sum(s.get('avail_minutes', 0) for s in month_shifts)
                total_n25 = sum(s.get('night_25_minutes', 0) for s in month_shifts)
                total_n40 = sum(s.get('night_40_minutes', 0) for s in month_shifts)
                diet_count = sum(1 for s in month_shifts if s.get('has_diet'))

                dcfg = all_configs.get(card_number, {})
                personal_nr = dcfg.get('personal_nr', '') or card_number
                double_diet = bool(dcfg.get('double_diet', 0))
                diet_rate = float(dcfg.get('diet_rate', 14.0))
                vma_per_day = diet_rate * 2 if double_diet else diet_rate

                return {
                    'driver_name': driver_name,
                    'card_number': card_number,
                    'personal_nr': personal_nr,
                    'double_diet': double_diet,
                    'diet_rate': diet_rate,
                    'summary': {
                        'total_work_minutes': total_work,
                        'total_work_hm': minutes_to_hm(total_work),
                        'total_driving_minutes': total_driving,
                        'total_driving_hm': minutes_to_hm(total_driving),
                        'total_break_minutes': total_break,
                        'total_break_hm': minutes_to_hm(total_break),
                        'total_avail_minutes': total_avail,
                        'night_25_minutes': total_n25,
                        'night_25_hm': minutes_to_hm(total_n25),
                        'night_40_minutes': total_n40,
                        'night_40_hm': minutes_to_hm(total_n40),
                        'diet_count': diet_count,
                        'effective_diet_count': diet_count,
                        'vma_amount': diet_count * vma_per_day,
                        'total_shifts': len(month_shifts),
                    },
                    'shifts': month_shifts,
                }
            except Exception:
                return None

        results = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(process_driver, t): t for t in tasks}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    results.append(result)

        results.sort(key=lambda r: r['driver_name'])
        _log_activity('settlement', f"{period} - {len(results)} drivers")
        return jsonify({'period': period, 'drivers': results})
    except Exception as exc:
        return jsonify({'error': f'Settlement error: {str(exc)}'}), 500


@bp.route('/api/driver-km', methods=['POST'])
@login_required
def api_driver_km():
    """Extract km (odometer) data from selected drivers' DDD files."""
    try:
        payload = request.get_json(force=True)
        date_from = payload.get('date_from', '')
        date_to = payload.get('date_to', '')
        selected_drivers = payload.get('driver_names', [])

        if not date_from or not date_to:
            return jsonify({'error': 'date_from and date_to required (YYYY-MM-DD)'}), 400

        dbx = get_server_dropbox_client()
        if not dbx:
            return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

        cached = load_portal_cache()
        if cached:
            drivers_data = cached
        else:
            sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
            drivers_data = build_drivers_data(dbx, sync_folder)

        selected_set = set(selected_drivers) if selected_drivers else None
        tasks = []
        for driver in drivers_data:
            name = driver.get('name', '')
            if selected_set and name not in selected_set:
                continue
            files = driver.get('files', [])
            if not files:
                continue
            file_path = files[0].get('path', '')
            if not file_path:
                continue
            tasks.append({
                'driver_name': name,
                'card_number': driver.get('card_number', ''),
                'file_path': file_path,
            })

        def process_driver_km(task):
            dbx_thread = get_server_dropbox_client()
            if not dbx_thread:
                return None
            try:
                _meta, response = dbx_thread.files_download(task['file_path'])
                with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
                    tmp.write(response.content)
                    tmp_path = tmp.name
                data = parse_ddd_auto(tmp_path, config_loader=_load_config)
                os.unlink(tmp_path)

                vehicles = get_vehicle_records(data)
                driver_info = get_driver_info(data)

                period_records = []
                total_km = 0
                for v in vehicles:
                    first_use = v.get('first_use', '')[:10]
                    last_use = v.get('last_use', '')[:10]
                    if not first_use:
                        continue
                    v_end = last_use or first_use
                    if v_end < date_from or first_use > date_to:
                        continue
                    odo_begin = v.get('odometer_begin_km', 0)
                    odo_end = v.get('odometer_end_km', 0)
                    km = max(0, odo_end - odo_begin)
                    total_km += km
                    period_records.append({
                        'plate': v.get('plate', ''),
                        'first_use': first_use,
                        'last_use': last_use,
                        'odometer_begin_km': odo_begin,
                        'odometer_end_km': odo_end,
                        'distance_km': km,
                    })

                if not period_records:
                    return None

                return {
                    'driver_name': task['driver_name'],
                    'card_number': driver_info.get('card_number', ''),
                    'vehicles': period_records,
                    'total_km': total_km,
                }
            except Exception as exc:
                logger.warning('Driver km error for %s: %s', task['driver_name'], exc)
                return None

        results = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(process_driver_km, t): t for t in tasks}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    results.append(result)

        results.sort(key=lambda r: r['driver_name'])
        _log_activity('driver_km', f"{date_from}-{date_to} - {len(results)} drivers")
        return jsonify({'date_from': date_from, 'date_to': date_to, 'drivers': results})
    except Exception as exc:
        return jsonify({'error': f'Driver km error: {str(exc)}'}), 500


@bp.route('/api/driver-monthly/<card_number>/<period>')
@login_required
def api_get_monthly_days(card_number, period):
    """Get vacation/sick days for a driver in a given month."""
    conn = _get_db()
    row = conn.execute(
        "SELECT vacation_days, sick_days, overtime_hm, notes, absence_days FROM driver_monthly_days WHERE card_number = ? AND period = ?",
        (card_number, period),
    ).fetchone()
    conn.close()
    if row:
        try:
            absence = _json.loads(row[4]) if row[4] else {}
        except Exception:
            absence = {}
        return jsonify({
            'card_number': card_number,
            'period': period,
            'vacation_days': row[0],
            'sick_days': row[1],
            'overtime_hm': row[2],
            'notes': row[3],
            'absence_days': absence,
        })
    return jsonify({
        'card_number': card_number,
        'period': period,
        'vacation_days': 0,
        'sick_days': 0,
        'overtime_hm': '',
        'notes': '',
        'absence_days': {},
    })


@bp.route('/api/driver-monthly/<card_number>/<period>', methods=['POST'])
@login_required
def api_set_monthly_days(card_number, period):
    """Set vacation/sick days for a driver in a given month."""
    body = request.get_json(force=True)
    vacation = float(body.get('vacation_days', 0))
    sick = float(body.get('sick_days', 0))
    overtime = body.get('overtime_hm', '')
    notes = body.get('notes', '')
    absence = body.get('absence_days', {})
    absence_str = _json.dumps(absence) if isinstance(absence, dict) else str(absence or '{}')
    now = datetime.utcnow().isoformat()

    conn = _get_db()
    conn.execute('''
        INSERT INTO driver_monthly_days (card_number, period, vacation_days, sick_days, overtime_hm, notes, absence_days, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(card_number, period) DO UPDATE SET
            vacation_days = excluded.vacation_days,
            sick_days = excluded.sick_days,
            overtime_hm = excluded.overtime_hm,
            notes = excluded.notes,
            absence_days = excluded.absence_days,
            updated_at = excluded.updated_at
    ''', (card_number, period, vacation, sick, overtime, notes, absence_str, now))
    conn.commit()
    conn.close()

    return jsonify({'ok': True})
