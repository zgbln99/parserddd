"""
DDD Reader – Flask API backend.

Serves JSON API endpoints for the React frontend.
Static frontend files are served by Nginx in production
or Flask's send_from_directory during development.
"""

import csv
import hashlib
import io
import json
import os
import re
import subprocess
import tempfile
import threading
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
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Marek2211.!')
LOGIN_HISTORY_FILE = os.environ.get('LOGIN_HISTORY_FILE', '/opt/ddd-reader/login_history.json')
USERS_FILE = os.environ.get('USERS_FILE', '/opt/ddd-reader/users.json')
ACTIVITY_LOG_FILE = os.environ.get('ACTIVITY_LOG_FILE', '/opt/ddd-reader/activity_log.json')
CONFIG_FILE = os.environ.get('CONFIG_FILE', '/opt/ddd-reader/config.json')
_activity_lock = threading.Lock()
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


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': 'Unauthorized'}), 401
        if session.get('role') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


def _record_login(role: str):
    """Append a login event to the history file."""
    entry = {
        'timestamp': datetime.now(UTC).isoformat(),
        'role': role,
        'ip': request.remote_addr or '',
        'user_agent': request.headers.get('User-Agent', '')[:200],
    }
    try:
        history = []
        if os.path.exists(LOGIN_HISTORY_FILE):
            with open(LOGIN_HISTORY_FILE) as f:
                history = json.load(f)
        history.append(entry)
        # Keep last 500 entries
        history = history[-500:]
        os.makedirs(os.path.dirname(LOGIN_HISTORY_FILE), exist_ok=True)
        with open(LOGIN_HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=2)
    except Exception:
        pass  # non-critical


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _load_users() -> list:
    try:
        if os.path.exists(USERS_FILE):
            with open(USERS_FILE) as f:
                return json.load(f)
    except Exception:
        pass
    return []


def _save_users(users: list):
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f, indent=2)


def _log_activity(action: str, detail: str = ''):
    entry = {
        'timestamp': datetime.now(UTC).isoformat(),
        'role': session.get('role', ''),
        'username': session.get('username', ''),
        'ip': request.remote_addr or '',
        'action': action,
        'detail': detail[:500],
    }
    try:
        with _activity_lock:
            log = []
            if os.path.exists(ACTIVITY_LOG_FILE):
                with open(ACTIVITY_LOG_FILE) as f:
                    log = json.load(f)
            log.append(entry)
            log = log[-1000:]
            os.makedirs(os.path.dirname(ACTIVITY_LOG_FILE), exist_ok=True)
            with open(ACTIVITY_LOG_FILE, 'w') as f:
                json.dump(log, f, indent=2)
    except Exception:
        pass


def _load_config() -> dict:
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE) as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_config(cfg: dict):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)


# ---------------------------------------------------------------------------
# Auth API
# ---------------------------------------------------------------------------


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    password = data.get('password', '')
    # Check hardcoded admin password
    if password == ADMIN_PASSWORD:
        session['logged_in'] = True
        session['role'] = 'admin'
        session['username'] = 'admin'
        _record_login('admin')
        return jsonify({'ok': True, 'role': 'admin', 'username': 'admin'})
    # Check hardcoded portal password
    if password == PORTAL_PASSWORD:
        session['logged_in'] = True
        session['role'] = 'user'
        session['username'] = 'user'
        _record_login('user')
        return jsonify({'ok': True, 'role': 'user', 'username': 'user'})
    # Check users from JSON file
    pw_hash = _hash_password(password)
    for u in _load_users():
        if u.get('password_hash') == pw_hash:
            role = u.get('role', 'user')
            session['logged_in'] = True
            session['role'] = role
            session['username'] = u.get('name', '')
            _record_login(role)
            return jsonify({'ok': True, 'role': role, 'username': u.get('name', '')})
    return jsonify({'error': 'Nieprawidłowe hasło'}), 401


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.pop('logged_in', None)
    session.pop('role', None)
    session.pop('username', None)
    return jsonify({'ok': True})


@app.route('/api/auth/status')
def api_auth_status():
    return jsonify({
        'logged_in': bool(session.get('logged_in')),
        'role': session.get('role', 'user'),
        'username': session.get('username', ''),
    })


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
    # Deduplicate overlapping intervals caused by UTC→CET day boundary overlap
    return deduplicate_timeline(all_intervals)


def deduplicate_timeline(intervals):
    """Remove overlapping intervals from adjacent UTC daily records."""
    if not intervals:
        return []
    sorted_ivs = sorted(intervals, key=lambda x: x[0])
    result = [list(sorted_ivs[0])]
    for start, end, wt in sorted_ivs[1:]:
        prev = result[-1]
        if start < prev[1]:
            # Overlap detected – trim the new interval's start
            if end <= prev[1]:
                # Completely contained within previous, skip
                continue
            # Partial overlap: keep only the non-overlapping tail
            start = prev[1]
        if end > start:
            # Merge adjacent same-type intervals
            if prev[2] == wt and abs((start - prev[1]).total_seconds()) < 60:
                prev[1] = end
            else:
                result.append([start, end, wt])
    return [(s, e, w) for s, e, w in result]


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
        # Diet only on weekdays (Mon=0..Fri=4), not on weekends
        is_weekday = shift_start.weekday() < 5
        has_diet = duration_minutes >= 8 * 60 and is_weekday
        if has_diet:
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

        weekday_names = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd']
        shift_details.append({
            'shift_start': shift_start.strftime('%Y-%m-%d %H:%M'),
            'shift_end': shift_end.strftime('%Y-%m-%d %H:%M'),
            'shift_date': shift_start.strftime('%Y-%m-%d'),
            'weekday': weekday_names[shift_start.weekday()],
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
            'has_diet': has_diet,
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
        _log_activity('analyze_upload', result.get('driver_info', {}).get('driver_name', ''))
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
        _log_activity('analyze_dropbox', f"{result.get('driver_info', {}).get('driver_name', '')} — {metadata.name}")
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
    from flask import Response
    safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'kierowca'
    filename = f"{safe_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@app.route('/api/export/pdf', methods=['POST'])
@login_required
def api_export_pdf():
    """Generate a PDF report from analysis data."""
    payload = request.json or {}
    driver_name = payload.get('driver_name', 'Kierowca')
    card_number = payload.get('card_number', '')
    summary = payload.get('summary', {})
    shifts = payload.get('shifts', [])

    # Build simple HTML-based PDF using basic HTML tables
    html_parts = [
        '<!DOCTYPE html><html><head><meta charset="utf-8">',
        '<style>',
        'body{font-family:Arial,sans-serif;font-size:11px;margin:20px;}',
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
        f'<h1>{driver_name}</h1>',
        f'<div class="meta">{card_number}</div>' if card_number else '',
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
    html_parts.append(f'<div class="footer">Portal DDD — wygenerowano {datetime.now().strftime("%Y-%m-%d %H:%M")}</div>')
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
    from flask import Response
    return Response(
        pdf_bytes,
        mimetype=content_type,
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
# Admin API
# ---------------------------------------------------------------------------


@app.route('/api/admin/login-history')
@admin_required
def api_login_history():
    """Return login history (admin only)."""
    try:
        if os.path.exists(LOGIN_HISTORY_FILE):
            with open(LOGIN_HISTORY_FILE) as f:
                history = json.load(f)
            history.reverse()
            return jsonify({'history': history})
        return jsonify({'history': []})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/activity-log')
@admin_required
def api_activity_log():
    """Return API activity log."""
    try:
        if os.path.exists(ACTIVITY_LOG_FILE):
            with open(ACTIVITY_LOG_FILE) as f:
                log = json.load(f)
            log.reverse()
            return jsonify({'log': log})
        return jsonify({'log': []})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# --- User management ---

@app.route('/api/admin/users')
@admin_required
def api_list_users():
    users = _load_users()
    # Strip password hashes
    safe = [{'id': u.get('id'), 'name': u.get('name'), 'role': u.get('role', 'user'),
             'created': u.get('created', '')} for u in users]
    return jsonify({'users': safe})


@app.route('/api/admin/users', methods=['POST'])
@admin_required
def api_create_user():
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'user')
    if not name or not password:
        return jsonify({'error': 'Name and password required'}), 400
    if role not in ('user', 'admin'):
        role = 'user'
    users = _load_users()
    new_id = max((u.get('id', 0) for u in users), default=0) + 1
    users.append({
        'id': new_id,
        'name': name,
        'password_hash': _hash_password(password),
        'role': role,
        'created': datetime.now(UTC).isoformat(),
    })
    _save_users(users)
    _log_activity('create_user', f"{name} ({role})")
    return jsonify({'ok': True, 'id': new_id})


@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def api_delete_user(user_id):
    users = _load_users()
    before = len(users)
    users = [u for u in users if u.get('id') != user_id]
    if len(users) == before:
        return jsonify({'error': 'User not found'}), 404
    _save_users(users)
    _log_activity('delete_user', f"id={user_id}")
    return jsonify({'ok': True})


# --- Password change ---

@app.route('/api/admin/change-password', methods=['POST'])
@admin_required
def api_change_password():
    """Change portal or admin password (writes to config file, not env)."""
    data = request.get_json(silent=True) or {}
    target = data.get('target', '')  # 'portal' or 'admin'
    new_password = data.get('new_password', '')
    if target not in ('portal', 'admin') or not new_password:
        return jsonify({'error': 'Invalid target or empty password'}), 400
    cfg = _load_config()
    cfg[f'{target}_password'] = new_password
    _save_config(cfg)
    # Update in-memory variable
    global PORTAL_PASSWORD, ADMIN_PASSWORD
    if target == 'portal':
        PORTAL_PASSWORD = new_password
    else:
        ADMIN_PASSWORD = new_password
    _log_activity('change_password', target)
    return jsonify({'ok': True})


# --- Sync config ---

@app.route('/api/admin/config')
@admin_required
def api_get_config():
    cfg = _load_config()
    return jsonify({
        'samsara_api_token': cfg.get('samsara_api_token', SAMSARA_API_TOKEN[:8] + '...' if SAMSARA_API_TOKEN else ''),
        'samsara_api_token_set': bool(SAMSARA_API_TOKEN or cfg.get('samsara_api_token')),
        'dropbox_refresh_token_set': bool(DROPBOX_REFRESH_TOKEN or cfg.get('dropbox_refresh_token')),
        'sync_dest_folder': cfg.get('sync_dest_folder', os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')),
    })


@app.route('/api/admin/config', methods=['POST'])
@admin_required
def api_update_config():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    for key in ('samsara_api_token', 'dropbox_refresh_token', 'sync_dest_folder'):
        if key in data and data[key]:
            cfg[key] = data[key]
    _save_config(cfg)
    # Update in-memory
    global SAMSARA_API_TOKEN, DROPBOX_REFRESH_TOKEN
    if 'samsara_api_token' in data and data['samsara_api_token']:
        SAMSARA_API_TOKEN = data['samsara_api_token']
    if 'dropbox_refresh_token' in data and data['dropbox_refresh_token']:
        DROPBOX_REFRESH_TOKEN = data['dropbox_refresh_token']
    _log_activity('update_config', ', '.join(data.keys()))
    return jsonify({'ok': True})


# --- DATEV export ---

@app.route('/api/export/datev', methods=['POST'])
@login_required
def api_export_datev():
    """Generate DATEV-compatible CSV from shift analysis data."""
    payload = request.json or {}
    driver_name = payload.get('driver_name', 'Fahrer')
    card_number = payload.get('card_number', '')
    summary = payload.get('summary', {})
    shifts = payload.get('shifts', [])
    period = payload.get('period', '')  # YYYY-MM

    # VMA daily rate (Germany, 8-24h absence)
    VMA_RATE = 14.0

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
    vma_amount = diet_count * VMA_RATE

    writer.writerow([
        card_number,
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
        n25 = fmt_de(s.get('night_25_minutes', 0) / 60)
        n40 = fmt_de(s.get('night_40_minutes', 0) / 60)
        writer.writerow([
            s.get('shift_date', ''),
            s.get('weekday', ''),
            s.get('shift_start', ''),
            s.get('shift_end', ''),
            s.get('work_hm', ''),
            s.get('driving_hm', ''),
            s.get('break_hm', ''),
            n25,
            n40,
            'JA' if s.get('has_diet') else '',
            ', '.join(s.get('vehicles', [])),
        ])

    csv_bytes = output.getvalue().encode('utf-8-sig')
    safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'fahrer'
    filename = f"DATEV_{safe_name}_{period or datetime.now().strftime('%Y-%m')}.csv"
    _log_activity('export_datev', f"{driver_name} {period}")
    from flask import Response
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


# --- Load persisted config on startup ---

def _apply_persisted_config():
    """Load config from JSON file and override env-based defaults."""
    global PORTAL_PASSWORD, ADMIN_PASSWORD, SAMSARA_API_TOKEN, DROPBOX_REFRESH_TOKEN
    cfg = _load_config()
    if cfg.get('portal_password'):
        PORTAL_PASSWORD = cfg['portal_password']
    if cfg.get('admin_password'):
        ADMIN_PASSWORD = cfg['admin_password']
    if cfg.get('samsara_api_token'):
        SAMSARA_API_TOKEN = cfg['samsara_api_token']
    if cfg.get('dropbox_refresh_token'):
        DROPBOX_REFRESH_TOKEN = cfg['dropbox_refresh_token']


_apply_persisted_config()


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
