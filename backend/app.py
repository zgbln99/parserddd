"""
DDD Reader – Flask API backend.

Serves JSON API endpoints for the React frontend.
Static frontend files are served by Nginx in production
or Flask's send_from_directory during development.
"""

import csv
import io
import json
import os
import re
import subprocess
import tempfile
from datetime import datetime, timedelta
from functools import wraps

import dropbox
import requests as http_requests
from dropbox.exceptions import AuthError
from flask import Flask, request, jsonify, session, send_from_directory
from flask_cors import CORS
from zoneinfo import ZoneInfo

UTC = ZoneInfo('UTC')
CET = ZoneInfo('Europe/Berlin')

# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'ddd-parser-secret-key-change-me')

# CORS for local dev (React on :5173, Flask on :8000)
CORS(app, supports_credentials=True, origins=[
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://dd.ltslog.de',
])

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DDDPARSER_PATH = os.environ.get('DDDPARSER_PATH', 'dddparser')
PORTAL_PASSWORD = os.environ.get('PORTAL_PASSWORD', 'lts2025')
DROPBOX_APP_KEY = os.environ.get('DROPBOX_APP_KEY', 'j9ntkihedd9495i')
DROPBOX_APP_SECRET = os.environ.get('DROPBOX_APP_SECRET', 'd3hr43reha9kky8')
DROPBOX_REFRESH_TOKEN = os.environ.get('DROPBOX_REFRESH_TOKEN', '')
SAMSARA_API_TOKEN = os.environ.get('SAMSARA_API_TOKEN', '')
SAMSARA_API_BASE = 'https://api.eu.samsara.com'
PORTAL_CACHE_FILE = os.environ.get('PORTAL_CACHE_FILE', '/opt/ddd-reader/portal_cache.json')
PORTAL_CACHE_MAX_AGE = 300  # 5 minutes

# Path to built React frontend
FRONTEND_DIR = os.environ.get(
    'FRONTEND_DIR',
    os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist'),
)

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Auth API
# ---------------------------------------------------------------------------


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    password = data.get('password', '')
    if password == PORTAL_PASSWORD:
        session['logged_in'] = True
        return jsonify({'ok': True})
    return jsonify({'error': 'Nieprawidłowe hasło'}), 401


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.pop('logged_in', None)
    return jsonify({'ok': True})


@app.route('/api/auth/status')
def api_auth_status():
    return jsonify({'logged_in': bool(session.get('logged_in'))})


# ---------------------------------------------------------------------------
# Dropbox helpers
# ---------------------------------------------------------------------------


def get_server_dropbox_client():
    if not DROPBOX_REFRESH_TOKEN:
        return None
    try:
        return dropbox.Dropbox(
            oauth2_refresh_token=DROPBOX_REFRESH_TOKEN,
            app_key=DROPBOX_APP_KEY,
            app_secret=DROPBOX_APP_SECRET,
        )
    except Exception:
        return None


# ---------------------------------------------------------------------------
# DDD parser & analysis (domain logic – stays in Python)
# ---------------------------------------------------------------------------


def parse_ddd_file(file_path):
    result = subprocess.run(
        [DDDPARSER_PATH, '-card', '-format', '-input', file_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Parser error: {result.stderr}")
    return json.loads(result.stdout)


def get_driver_info(data):
    info = {}
    for key in ['card_identification_and_driver_card_holder_identification_1',
                'card_identification_and_driver_card_holder_identification_2']:
        block = data.get(key)
        if block:
            card_id = block.get('card_identification') or {}
            holder = block.get('driver_card_holder_identification') or {}
            info['card_number'] = card_id.get('card_number', '')
            info['card_issuing_authority'] = card_id.get('card_issuing_authority_name', '')
            info['card_issue_date'] = card_id.get('card_issue_date')
            info['card_expiry_date'] = card_id.get('card_expiry_date')
            name = holder.get('card_holder_name') or {}
            surname = name.get('holder_surname', '')
            first_name = name.get('holder_first_names', '')
            info['driver_name'] = f"{surname} {first_name}".strip()
            info['birth_date'] = holder.get('card_holder_birth_date')
            break
    return info


def get_activity_records(data):
    records = []
    for key in ['card_driver_activity_1', 'card_driver_activity_2']:
        activity = data.get(key)
        if activity:
            recs = activity.get('decoded_activity_daily_records') or []
            records.extend(recs)
    return records


def get_vehicle_records(data):
    vehicles = []
    seen = set()
    for key in ['card_vehicles_used_1', 'card_vehicles_used_2']:
        block = data.get(key)
        if not block:
            continue
        for rec in (block.get('card_vehicle_records') or []):
            reg = rec.get('vehicle_registration', {})
            plate = reg.get('vehicle_registration_number', '').strip()
            if not plate:
                continue
            first_use = rec.get('vehicle_first_use', '')
            last_use = rec.get('vehicle_last_use', '')
            dedup_key = (plate, first_use, last_use)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            vehicles.append({'plate': plate, 'first_use': first_use, 'last_use': last_use})
    vehicles.sort(key=lambda v: v.get('first_use', ''))
    return vehicles


def parse_date_safe(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def minutes_to_hm(minutes):
    h = minutes // 60
    m = minutes % 60
    return f"{h}:{m:02d}"


def minutes_to_decimal(minutes):
    return round(minutes / 60, 2)


def build_timeline(records):
    all_intervals = []
    sorted_records = sorted(records, key=lambda r: r.get('activity_record_date', ''))
    for record in sorted_records:
        date_str = record.get('activity_record_date')
        if not date_str:
            continue
        base_date = datetime.strptime(date_str[:10], '%Y-%m-%d').replace(tzinfo=UTC)
        changes = record.get('activity_change_info') or []
        for i, change in enumerate(changes):
            start_min = change['minutes']
            work_type = change['work_type']
            end_min = changes[i + 1]['minutes'] if i + 1 < len(changes) else 1440
            if end_min > start_min:
                start_dt = (base_date + timedelta(minutes=start_min)).astimezone(CET).replace(tzinfo=None)
                end_dt = (base_date + timedelta(minutes=end_min)).astimezone(CET).replace(tzinfo=None)
                all_intervals.append((start_dt, end_dt, work_type))
    return all_intervals


def merge_intervals(intervals):
    if not intervals:
        return []
    merged = [list(intervals[0])]
    for start, end, wt in intervals[1:]:
        prev = merged[-1]
        if prev[2] == wt and abs((start - prev[1]).total_seconds()) < 60:
            prev[1] = end
        else:
            merged.append([start, end, wt])
    return [(s, e, w) for s, e, w in merged]


def detect_shifts(all_intervals, min_rest_hours=9):
    if not all_intervals:
        return []
    merged = merge_intervals(all_intervals)
    min_rest_sec = min_rest_hours * 3600
    shifts = []
    current = []
    for start, end, wt in merged:
        if wt == 0:
            duration_sec = (end - start).total_seconds()
            if duration_sec >= min_rest_sec:
                if current:
                    shifts.append(current)
                    current = []
                continue
        current.append((start, end, wt))
    if current:
        shifts.append(current)
    return shifts


def calculate_shift_night_hours(intervals, shift_start):
    night_25_sec = 0
    night_40_sec = 0
    for start_dt, end_dt, work_type in intervals:
        if work_type == 0:
            continue
        current = start_dt
        while current < end_dt:
            day_base = current.replace(hour=0, minute=0, second=0, microsecond=0)
            next_day = day_base + timedelta(days=1)
            chunk_end = min(end_dt, next_day)
            # 22:00-00:00 => always 25%
            o_start = max(current, day_base + timedelta(hours=22))
            o_end = min(chunk_end, day_base + timedelta(hours=24))
            if o_end > o_start:
                night_25_sec += (o_end - o_start).total_seconds()
            # 00:00-04:00 => 40% if shift started before midnight, else 25%
            o_start = max(current, day_base)
            o_end = min(chunk_end, day_base + timedelta(hours=4))
            if o_end > o_start:
                secs = (o_end - o_start).total_seconds()
                if shift_start < day_base:
                    night_40_sec += secs
                else:
                    night_25_sec += secs
            # 04:00-06:00 => always 25%
            o_start = max(current, day_base + timedelta(hours=4))
            o_end = min(chunk_end, day_base + timedelta(hours=6))
            if o_end > o_start:
                night_25_sec += (o_end - o_start).total_seconds()
            current = next_day
    return int(round(night_25_sec / 60)), int(round(night_40_sec / 60))


def analyze_card(data):
    driver_info = get_driver_info(data)
    records = get_activity_records(data)
    vehicles = get_vehicle_records(data)
    timeline = build_timeline(records)
    shifts = detect_shifts(timeline)

    shift_details = []
    total_work = total_driving = total_break = total_avail = 0
    total_n25 = total_n40 = 0
    diet_count = 0

    for shift_intervals in shifts:
        if not shift_intervals:
            continue
        shift_start = shift_intervals[0][0]
        shift_end = shift_intervals[-1][1]

        break_sec = sum((e - s).total_seconds() for s, e, wt in shift_intervals if wt == 0)
        avail_sec = sum((e - s).total_seconds() for s, e, wt in shift_intervals if wt == 1)
        work_only_sec = sum((e - s).total_seconds() for s, e, wt in shift_intervals if wt == 2)
        driving_sec = sum((e - s).total_seconds() for s, e, wt in shift_intervals if wt == 3)

        work_sec = work_only_sec + driving_sec + avail_sec
        work_minutes = int(round(work_sec / 60))
        break_minutes = int(round(break_sec / 60))
        avail_minutes = int(round(avail_sec / 60))
        driving_minutes = int(round(driving_sec / 60))
        work_only_minutes = int(round(work_only_sec / 60))
        duration_minutes = int(round((shift_end - shift_start).total_seconds() / 60))

        night_25, night_40 = calculate_shift_night_hours(shift_intervals, shift_start)
        total_work += work_minutes
        total_driving += driving_minutes
        total_break += break_minutes
        total_avail += avail_minutes
        total_n25 += night_25
        total_n40 += night_40
        if duration_minutes > 8 * 60:
            diet_count += 1

        shift_start_date = shift_start.date()
        shift_end_date = shift_end.date()
        day_plates = []
        for v in vehicles:
            v_start = parse_date_safe(v.get('first_use', ''))
            v_end = parse_date_safe(v.get('last_use', ''))
            if v_start and v_end and v_start <= shift_end_date and v_end >= shift_start_date:
                day_plates.append(v['plate'])
        unique_plates = list(dict.fromkeys(day_plates))

        shift_details.append({
            'shift_start': shift_start.strftime('%Y-%m-%d %H:%M'),
            'shift_end': shift_end.strftime('%Y-%m-%d %H:%M'),
            'shift_date': shift_start.strftime('%Y-%m-%d'),
            'duration_minutes': duration_minutes,
            'duration_hm': minutes_to_hm(duration_minutes),
            'work_minutes': work_minutes,
            'work_hm': minutes_to_hm(work_minutes),
            'work_decimal': minutes_to_decimal(work_minutes),
            'driving_minutes': driving_minutes,
            'driving_hm': minutes_to_hm(driving_minutes),
            'work_only_minutes': work_only_minutes,
            'work_only_hm': minutes_to_hm(work_only_minutes),
            'avail_minutes': avail_minutes,
            'avail_hm': minutes_to_hm(avail_minutes),
            'break_minutes': break_minutes,
            'break_hm': minutes_to_hm(break_minutes),
            'night_25_minutes': night_25,
            'night_25_hm': minutes_to_hm(night_25),
            'night_40_minutes': night_40,
            'night_40_hm': minutes_to_hm(night_40),
            'has_diet': duration_minutes > 8 * 60,
            'vehicles': unique_plates,
        })

    total_night = total_n25 + total_n40
    return {
        'driver_info': driver_info,
        'vehicles': vehicles,
        'summary': {
            'total_work_hm': minutes_to_hm(total_work),
            'total_work_decimal': minutes_to_decimal(total_work),
            'total_work_minutes': total_work,
            'total_driving_hm': minutes_to_hm(total_driving),
            'total_driving_minutes': total_driving,
            'total_break_hm': minutes_to_hm(total_break),
            'total_break_minutes': total_break,
            'total_avail_hm': minutes_to_hm(total_avail),
            'total_avail_minutes': total_avail,
            'night_25_hm': minutes_to_hm(total_n25),
            'night_25_decimal': minutes_to_decimal(total_n25),
            'night_25_minutes': total_n25,
            'night_40_hm': minutes_to_hm(total_n40),
            'night_40_decimal': minutes_to_decimal(total_n40),
            'night_40_minutes': total_n40,
            'total_night_hm': minutes_to_hm(total_night),
            'total_night_decimal': minutes_to_decimal(total_night),
            'total_night_minutes': total_night,
            'diet_count': diet_count,
            'total_shifts': len(shift_details),
        },
        'shift_details': shift_details,
    }


# ---------------------------------------------------------------------------
# Portal / Drivers API
# ---------------------------------------------------------------------------


def build_drivers_data(dbx, sync_folder):
    result = dbx.files_list_folder(sync_folder, recursive=True)
    all_entries = list(result.entries)
    while result.has_more:
        result = dbx.files_list_folder_continue(result.cursor)
        all_entries.extend(result.entries)

    driver_files = {}
    driver_paths = {}
    for entry in all_entries:
        if isinstance(entry, dropbox.files.FolderMetadata):
            rel = entry.path_display[len(sync_folder):].strip('/')
            if '/' not in rel and rel:
                driver_paths[rel] = entry.path_display
            continue
        if not isinstance(entry, dropbox.files.FileMetadata):
            continue
        rel = entry.path_display[len(sync_folder):].strip('/')
        parts = rel.split('/')
        if len(parts) != 2:
            continue
        driver_name = parts[0]
        fname = parts[1]
        if driver_name not in driver_files:
            driver_files[driver_name] = []

        card_number = ''
        file_date = ''
        m = re.match(r'^(.+?)_(\d{4}-\d{2}-\d{2})\.ddd$', fname, re.IGNORECASE)
        if m:
            card_number = m.group(1)
            file_date = m.group(2)

        driver_files[driver_name].append({
            'name': fname,
            'path': entry.path_display,
            'size': entry.size,
            'modified': entry.server_modified.isoformat() if entry.server_modified else '',
            'card_number': card_number,
            'file_date': file_date,
        })

    drivers = []
    for driver_name in set(driver_paths.keys()) | set(driver_files.keys()):
        files = driver_files.get(driver_name, [])
        files.sort(key=lambda x: x.get('file_date', ''), reverse=True)

        earliest_date = latest_date = latest_download = card_number = ''
        if files:
            dates = [f['file_date'] for f in files if f['file_date']]
            if dates:
                earliest_date = min(dates)
                latest_date = max(dates)
            modified_dates = [f['modified'] for f in files if f['modified']]
            if modified_dates:
                latest_download = max(modified_dates)
            for f in files:
                if f['card_number']:
                    card_number = f['card_number']
                    break

        days_since = None
        if latest_download:
            try:
                last_dt = datetime.fromisoformat(latest_download)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=UTC)
                days_since = (datetime.now(UTC) - last_dt).days
            except Exception:
                pass

        drivers.append({
            'name': driver_name,
            'path': driver_paths.get(driver_name, f'{sync_folder}/{driver_name}'),
            'card_number': card_number,
            'file_count': len(files),
            'earliest_date': earliest_date,
            'latest_date': latest_date,
            'latest_download': latest_download,
            'days_since': days_since,
            'files': files,
        })

    drivers.sort(key=lambda d: d.get('latest_download', ''), reverse=True)
    return drivers


def load_portal_cache():
    try:
        if os.path.exists(PORTAL_CACHE_FILE):
            mtime = os.path.getmtime(PORTAL_CACHE_FILE)
            age = datetime.now().timestamp() - mtime
            if age < PORTAL_CACHE_MAX_AGE:
                with open(PORTAL_CACHE_FILE) as f:
                    return json.load(f)
    except Exception:
        pass
    return None


def save_portal_cache(drivers):
    try:
        with open(PORTAL_CACHE_FILE, 'w') as f:
            json.dump(drivers, f)
    except Exception:
        pass


@app.route('/api/drivers')
@login_required
def api_drivers():
    force = request.args.get('refresh') == '1'
    if not force:
        cached = load_portal_cache()
        if cached is not None:
            for d in cached:
                if d.get('latest_download'):
                    try:
                        last_dt = datetime.fromisoformat(d['latest_download'])
                        if last_dt.tzinfo is None:
                            last_dt = last_dt.replace(tzinfo=UTC)
                        d['days_since'] = (datetime.now(UTC) - last_dt).days
                    except Exception:
                        pass
            return jsonify({'drivers': cached, 'cached': True})

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak połączenia z Dropbox (brak DROPBOX_REFRESH_TOKEN)'}), 500

    sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
    try:
        drivers = build_drivers_data(dbx, sync_folder)
        save_portal_cache(drivers)
        return jsonify({'drivers': drivers})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# File analysis API
# ---------------------------------------------------------------------------


@app.route('/api/analyze', methods=['POST'])
@login_required
def api_analyze_upload():
    """Upload a .ddd file and return analysis."""
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nie wybrano pliku'}), 400
    try:
        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name
        data = parse_ddd_file(tmp_path)
        result = analyze_card(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'tmp_path' in locals():
            os.unlink(tmp_path)


@app.route('/api/analyze/dropbox')
@login_required
def api_analyze_dropbox():
    """Download a DDD file from Dropbox and return analysis."""
    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak połączenia z Dropbox'}), 500
    file_path = request.args.get('path')
    if not file_path:
        return jsonify({'error': 'Brak ścieżki pliku'}), 400
    try:
        metadata, response = dbx.files_download(file_path)
        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name
        data = parse_ddd_file(tmp_path)
        result = analyze_card(data)
        result['source_file'] = metadata.name
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'tmp_path' in locals():
            os.unlink(tmp_path)


@app.route('/api/export/csv', methods=['POST'])
@login_required
def api_export_csv():
    """Generate CSV from shift data and return it."""
    payload = request.json or {}
    driver_name = payload.get('driver_name', 'kierowca')
    shifts = payload.get('shifts', [])

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow([
        'Start', 'Koniec', 'Czas trwania', 'Pojazd', 'Jazda', 'Praca',
        'Przerwy', 'Czas pracy', 'Nocne 25%', 'Nocne 40%', 'Dieta',
    ])
    for s in shifts:
        writer.writerow([
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
    from flask import Response
    safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'kierowca'
    filename = f"{safe_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Sync status API
# ---------------------------------------------------------------------------


@app.route('/api/sync/status')
@login_required
def api_sync_status():
    state_file = os.environ.get('SYNC_STATE_FILE', '/opt/ddd-reader/samsara_sync_state.json')
    try:
        if os.path.exists(state_file):
            with open(state_file) as f:
                data = json.load(f)
            return jsonify({
                'last_sync': data.get('last_sync', ''),
                'synced_count': len(data.get('synced_ids', [])),
            })
        return jsonify({'last_sync': '', 'synced_count': 0})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sync/log')
@login_required
def api_sync_log():
    history_file = os.environ.get('SYNC_HISTORY_FILE', '/opt/ddd-reader/samsara_sync_history.json')
    try:
        if os.path.exists(history_file):
            with open(history_file) as f:
                history = json.load(f)
            history.reverse()
            return jsonify({'history': history})
        return jsonify({'history': []})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Dashboard summary API
# ---------------------------------------------------------------------------


@app.route('/api/dashboard')
@login_required
def api_dashboard():
    """Aggregate summary for the dashboard."""
    # Drivers count from cache
    cached = load_portal_cache()
    driver_count = len(cached) if cached else 0
    total_files = sum(d.get('file_count', 0) for d in cached) if cached else 0

    # Sync status
    state_file = os.environ.get('SYNC_STATE_FILE', '/opt/ddd-reader/samsara_sync_state.json')
    last_sync = ''
    synced_count = 0
    try:
        if os.path.exists(state_file):
            with open(state_file) as f:
                data = json.load(f)
            last_sync = data.get('last_sync', '')
            synced_count = len(data.get('synced_ids', []))
    except Exception:
        pass

    # Last sync history entry
    history_file = os.environ.get('SYNC_HISTORY_FILE', '/opt/ddd-reader/samsara_sync_history.json')
    last_sync_status = ''
    last_sync_errors = 0
    last_sync_uploaded = 0
    try:
        if os.path.exists(history_file):
            with open(history_file) as f:
                history = json.load(f)
            if history:
                last = history[-1]
                last_sync_status = last.get('status', '')
                last_sync_errors = last.get('errors', 0)
                last_sync_uploaded = last.get('uploaded', 0)
    except Exception:
        pass

    return jsonify({
        'driver_count': driver_count,
        'total_files': total_files,
        'last_sync': last_sync,
        'synced_count': synced_count,
        'last_sync_status': last_sync_status,
        'last_sync_errors': last_sync_errors,
        'last_sync_uploaded': last_sync_uploaded,
    })


# ---------------------------------------------------------------------------
# Connection status API
# ---------------------------------------------------------------------------


@app.route('/api/status/connections')
@login_required
def api_connection_status():
    """Check Dropbox and Samsara connectivity."""
    result = {'dropbox': False, 'samsara': False}

    # Check Dropbox
    dbx = get_server_dropbox_client()
    if dbx:
        try:
            dbx.users_get_current_account()
            result['dropbox'] = True
        except Exception:
            pass

    # Check Samsara
    if SAMSARA_API_TOKEN:
        try:
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/drivers',
                headers={'Authorization': f'Bearer {SAMSARA_API_TOKEN}'},
                params={'limit': 1},
                timeout=5,
            )
            result['samsara'] = resp.status_code == 200
        except Exception:
            pass

    return jsonify(result)


# ---------------------------------------------------------------------------
# Backward-compatible routes (keep old endpoints working)
# ---------------------------------------------------------------------------


@app.route('/portal/drivers')
@login_required
def portal_drivers():
    return api_drivers()


@app.route('/portal/download')
@login_required
def portal_download():
    return api_analyze_dropbox()


@app.route('/portal/sync-status')
@login_required
def portal_sync_status():
    return api_sync_status()


@app.route('/portal/sync-log')
@login_required
def portal_sync_log():
    return api_sync_log()


@app.route('/upload', methods=['POST'])
@login_required
def upload():
    return api_analyze_upload()


# ---------------------------------------------------------------------------
# Serve frontend (SPA fallback)
# ---------------------------------------------------------------------------


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """Serve React static build. Falls back to index.html for SPA routing."""
    abs_frontend = os.path.abspath(FRONTEND_DIR)
    if path and os.path.isfile(os.path.join(abs_frontend, path)):
        return send_from_directory(abs_frontend, path)
    index_path = os.path.join(abs_frontend, 'index.html')
    if os.path.isfile(index_path):
        return send_from_directory(abs_frontend, 'index.html')
    return jsonify({'error': 'Frontend not built. Run: cd frontend && npm run build'}), 404


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8000)
