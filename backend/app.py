"""
DDD Reader – Flask API backend.

Serves JSON API endpoints for the React frontend.
Static frontend files are served by Nginx in production
or Flask's send_from_directory during development.
"""

import csv
import math
import hashlib
import io
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from functools import wraps

import dropbox
import requests as http_requests
from dropbox.exceptions import AuthError
from flask import Flask, request, jsonify, session, send_from_directory
from flask_cors import CORS
from zoneinfo import ZoneInfo

try:
    import bcrypt
    _HAS_BCRYPT = True
except ImportError:
    _HAS_BCRYPT = False

try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    _HAS_LIMITER = True
except ImportError:
    _HAS_LIMITER = False

UTC = ZoneInfo('UTC')
CET = ZoneInfo('Europe/Berlin')

# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # Keep Lax for cross-origin redirects
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=12)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'ddd-parser-secret-key-change-me')

# CORS for local dev (React on :5173, Flask on :8000)
CORS(app, supports_credentials=True, origins=[
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://dd.ltslog.de',
])

# Global rate limiter (30 requests/minute per IP for all API endpoints)
if _HAS_LIMITER:
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=["60 per minute"],
        storage_uri="memory://",
    )
    # Stricter limit for auth endpoints
    auth_limit = limiter.limit("10 per minute")
    # More generous for data endpoints
    data_limit = limiter.limit("120 per minute")
else:
    limiter = None

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
_login_attempts: dict = {}  # IP -> (count, first_attempt_time)
_login_lock = threading.Lock()
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300  # 5 minutes
DATABASE_FILE = os.environ.get('DATABASE_FILE', '/opt/ddd-reader/ddd_portal.db')
DROPBOX_APP_KEY = os.environ.get('DROPBOX_APP_KEY', 'j9ntkihedd9495i')
DROPBOX_APP_SECRET = os.environ.get('DROPBOX_APP_SECRET', 'd3hr43reha9kky8')
DROPBOX_REFRESH_TOKEN = os.environ.get('DROPBOX_REFRESH_TOKEN', '')
SAMSARA_API_TOKEN = os.environ.get('SAMSARA_API_TOKEN', '')
SAMSARA_API_BASE = 'https://api.eu.samsara.com'
PORTAL_CACHE_FILE = os.environ.get('PORTAL_CACHE_FILE', '/opt/ddd-reader/portal_cache.json')
PORTAL_CACHE_MAX_AGE = 900  # 15 minutes
VEHICLE_ACTIVITY_CACHE = {}  # key: (period, tuple(vehicle_ids)) -> (timestamp, response_data)
VEHICLE_ACTIVITY_CACHE_TTL = 300  # 5 minutes
COMPANY_LOGO_PATH = os.environ.get('COMPANY_LOGO_PATH', '')

import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger('ddd-reader')

# Warn about default credentials
_INSECURE_DEFAULTS = {
    'PORTAL_PASSWORD': 'lts2025',
    'ADMIN_PASSWORD': 'Marek2211.!',
    'FLASK_SECRET_KEY': 'ddd-parser-secret-key-change-me',
}
for _env_key, _default_val in _INSECURE_DEFAULTS.items():
    if os.environ.get(_env_key, _default_val) == _default_val:
        logger.warning('⚠ %s is using default value — set it via environment variable!', _env_key)

# Path to built React frontend
FRONTEND_DIR = os.environ.get(
    'FRONTEND_DIR',
    os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist'),
)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def _haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance in km between two GPS points using Haversine formula."""
    R = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _get_db() -> sqlite3.Connection:
    """Get a thread-local SQLite connection."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def _init_db():
    """Create database tables if they don't exist."""
    os.makedirs(os.path.dirname(DATABASE_FILE), exist_ok=True)
    conn = _get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS driver_config (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number   TEXT UNIQUE NOT NULL,
            driver_name   TEXT NOT NULL DEFAULT '',
            personal_nr   TEXT NOT NULL DEFAULT '',
            double_diet   INTEGER NOT NULL DEFAULT 0,
            diet_rate     REAL NOT NULL DEFAULT 14.0,
            notes         TEXT NOT NULL DEFAULT '',
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
    ''')
    # Add card_expiry_date column if missing (migration)
    try:
        conn.execute("SELECT card_expiry_date FROM driver_config LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_config ADD COLUMN card_expiry_date TEXT NOT NULL DEFAULT ''")
        conn.commit()

    # Monthly days table (vacation/sick per driver per month)
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS driver_monthly_days (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number   TEXT NOT NULL,
            period        TEXT NOT NULL,
            vacation_days REAL NOT NULL DEFAULT 0,
            sick_days     REAL NOT NULL DEFAULT 0,
            overtime_hm   TEXT NOT NULL DEFAULT '',
            notes         TEXT NOT NULL DEFAULT '',
            absence_days  TEXT NOT NULL DEFAULT '{}',
            updated_at    TEXT NOT NULL,
            UNIQUE(card_number, period)
        );
    ''')
    # Add absence_days column if missing (migration)
    try:
        conn.execute("SELECT absence_days FROM driver_monthly_days LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_monthly_days ADD COLUMN absence_days TEXT NOT NULL DEFAULT '{}'")
        conn.commit()
    # Config audit log table
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS config_audit_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number   TEXT NOT NULL DEFAULT '',
            driver_name   TEXT NOT NULL DEFAULT '',
            action        TEXT NOT NULL,
            field_name    TEXT NOT NULL DEFAULT '',
            old_value     TEXT NOT NULL DEFAULT '',
            new_value     TEXT NOT NULL DEFAULT '',
            changed_by    TEXT NOT NULL DEFAULT 'admin',
            changed_at    TEXT NOT NULL
        );
    ''')

    conn.commit()
    conn.close()


_init_db()


def _cache_card_expiry(card_number, card_expiry_date, driver_name=''):
    """Cache card_expiry_date in driver_config (upsert)."""
    if not card_number or not card_expiry_date:
        return
    now = datetime.utcnow().isoformat()
    conn = _get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM driver_config WHERE card_number = ?", (card_number,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE driver_config SET card_expiry_date = ?, updated_at = ? WHERE card_number = ?",
                (card_expiry_date, now, card_number),
            )
        else:
            conn.execute(
                "INSERT INTO driver_config (card_number, driver_name, card_expiry_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (card_number, driver_name, card_expiry_date, now, now),
            )
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


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


def _record_login(role: str, username: str = ''):
    """Append a login event to the history file."""
    entry = {
        'timestamp': datetime.now(UTC).isoformat(),
        'role': role,
        'username': username or role,
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
    """Hash password with bcrypt if available, fall back to SHA256."""
    if _HAS_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    return hashlib.sha256(password.encode()).hexdigest()


def _verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against stored hash (supports both bcrypt and SHA256)."""
    if _HAS_BCRYPT and stored_hash.startswith('$2'):
        try:
            return bcrypt.checkpw(password.encode(), stored_hash.encode())
        except Exception:
            return False
    # Fall back to SHA256 comparison
    return hashlib.sha256(password.encode()).hexdigest() == stored_hash


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


def _log_config_change(action: str, detail: str = '', card_number: str = '', driver_name: str = '', changes: list = None):
    """Log configuration changes with full context and field-level diffs."""
    _log_activity(f'config_change:{action}', detail)
    if changes:
        now = datetime.now(UTC).isoformat()
        try:
            conn = _get_db()
            for ch in changes:
                conn.execute('''
                    INSERT INTO config_audit_log (card_number, driver_name, action, field_name, old_value, new_value, changed_by, changed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (card_number, driver_name, action, ch.get('field', ''), str(ch.get('old', '')), str(ch.get('new', '')), 'admin', now))
            conn.commit()
            conn.close()
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


def _check_rate_limit(ip: str) -> bool:
    """Return True if this IP is rate-limited."""
    now = datetime.now(UTC).timestamp()
    with _login_lock:
        if ip in _login_attempts:
            count, first_time = _login_attempts[ip]
            if now - first_time > LOGIN_WINDOW_SECONDS:
                _login_attempts[ip] = (0, now)
                return False
            if count >= LOGIN_MAX_ATTEMPTS:
                return True
        return False


def _record_failed_login(ip: str):
    now = datetime.now(UTC).timestamp()
    with _login_lock:
        if ip in _login_attempts:
            count, first_time = _login_attempts[ip]
            if now - first_time > LOGIN_WINDOW_SECONDS:
                _login_attempts[ip] = (1, now)
            else:
                _login_attempts[ip] = (count + 1, first_time)
        else:
            _login_attempts[ip] = (1, now)


def _clear_rate_limit(ip: str):
    with _login_lock:
        _login_attempts.pop(ip, None)


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    ip = request.remote_addr or '0.0.0.0'
    if _check_rate_limit(ip):
        return jsonify({'error': 'Too many login attempts. Try again in 5 minutes.'}), 429

    data = request.get_json(silent=True) or {}
    password = data.get('password', '')

    if not password or len(password) > 200:
        _record_failed_login(ip)
        return jsonify({'error': 'Nieprawidłowe hasło'}), 401

    # Check hardcoded admin password
    if password == ADMIN_PASSWORD:
        session['logged_in'] = True
        session['role'] = 'admin'
        session['username'] = 'admin'
        _record_login('admin', 'admin')
        _clear_rate_limit(ip)
        return jsonify({'ok': True, 'role': 'admin', 'username': 'admin'})
    # Check hardcoded portal password
    if password == PORTAL_PASSWORD:
        session['logged_in'] = True
        session['role'] = 'user'
        session['username'] = 'user'
        _record_login('user', 'user')
        _clear_rate_limit(ip)
        return jsonify({'ok': True, 'role': 'user', 'username': 'user'})
    # Check users from JSON file
    for u in _load_users():
        if _verify_password(password, u.get('password_hash', '')):
            role = u.get('role', 'user')
            session['logged_in'] = True
            session['role'] = role
            session['username'] = u.get('name', '')
            _record_login(role, u.get('name', ''))
            _clear_rate_limit(ip)
            return jsonify({'ok': True, 'role': role, 'username': u.get('name', '')})
    _record_failed_login(ip)
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


def get_card_places(data):
    """Extract card_places (country entries at start/end of daily work) from DDD data."""
    places = []
    for key in ['card_places_1', 'card_places_2',
                'card_places_daily_work_periods_1', 'card_places_daily_work_periods_2']:
        block = data.get(key)
        if not block:
            continue
        records = block if isinstance(block, list) else block.get('place_records', block.get('records', []))
        if isinstance(records, list):
            for rec in records:
                place = {
                    'date': rec.get('entry_time', rec.get('date', '')),
                    'country': rec.get('country', rec.get('entry_country', '')),
                    'region': rec.get('region', rec.get('entry_region', '')),
                    'type': rec.get('type', ''),  # 'start' or 'end'
                }
                if place['date'] and place['country']:
                    places.append(place)
    return places


def get_card_events(data):
    """Extract card events and faults from DDD data."""
    events = []
    for key in ['card_events_and_faults_1', 'card_events_and_faults_2']:
        block = data.get(key)
        if not block:
            continue
        for event_list_key in ['card_event_records', 'event_records', 'events']:
            event_list = block.get(event_list_key, [])
            if isinstance(event_list, list):
                events.extend(event_list)
    return events


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
            odo_begin = rec.get('vehicle_odometer_begin', 0)
            odo_end = rec.get('vehicle_odometer_end', 0)
            dedup_key = (plate, first_use, last_use)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            vehicles.append({
                'plate': plate,
                'first_use': first_use,
                'last_use': last_use,
                'odometer_begin_km': int(odo_begin) if odo_begin else 0,
                'odometer_end_km': int(odo_end) if odo_end else 0,
            })
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
            is_manual = not change.get('card_present', True)
            end_min = changes[i + 1]['minutes'] if i + 1 < len(changes) else 1440
            if end_min > start_min:
                start_dt = (base_date + timedelta(minutes=start_min)).astimezone(CET).replace(tzinfo=None)
                end_dt = (base_date + timedelta(minutes=end_min)).astimezone(CET).replace(tzinfo=None)
                all_intervals.append((start_dt, end_dt, work_type, is_manual))
    # Deduplicate overlapping intervals caused by UTC→CET day boundary overlap
    return deduplicate_timeline(all_intervals)


def deduplicate_timeline(intervals):
    """Remove overlapping intervals from adjacent UTC daily records.
    Each interval is (start, end, work_type, is_manual)."""
    if not intervals:
        return []
    sorted_ivs = sorted(intervals, key=lambda x: x[0])
    result = [list(sorted_ivs[0])]
    for start, end, wt, manual in sorted_ivs[1:]:
        prev = result[-1]
        if start < prev[1]:
            if end <= prev[1]:
                continue
            start = prev[1]
        if end > start:
            if prev[2] == wt and prev[3] == manual and abs((start - prev[1]).total_seconds()) < 60:
                prev[1] = end
            else:
                result.append([start, end, wt, manual])
    return [(s, e, w, m) for s, e, w, m in result]


def merge_intervals(intervals):
    if not intervals:
        return []
    merged = [list(intervals[0])]
    for start, end, wt, manual in intervals[1:]:
        prev = merged[-1]
        if prev[2] == wt and prev[3] == manual and abs((start - prev[1]).total_seconds()) < 60:
            prev[1] = end
        else:
            merged.append([start, end, wt, manual])
    return [(s, e, w, m) for s, e, w, m in merged]


def detect_shifts(all_intervals, min_rest_hours=9):
    if not all_intervals:
        return []
    merged = merge_intervals(all_intervals)
    min_rest_sec = min_rest_hours * 3600
    shifts = []
    current = []
    for start, end, wt, manual in merged:
        if wt == 0:
            duration_sec = (end - start).total_seconds()
            if duration_sec >= min_rest_sec:
                if current:
                    shifts.append(current)
                    current = []
                continue
        current.append((start, end, wt, manual))
    if current:
        shifts.append(current)
    return shifts


def calculate_shift_night_hours(intervals, shift_start):
    night_25_sec = 0
    night_40_sec = 0
    for interval in intervals:
        start_dt, end_dt, work_type = interval[0], interval[1], interval[2]
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
    places = get_card_places(data)
    card_events = get_card_events(data)
    timeline = build_timeline(records)
    shifts = detect_shifts(timeline)

    shift_details = []
    total_work = total_driving = total_break = total_avail = 0
    total_n25 = total_n40 = 0
    total_manual = 0
    diet_count = 0

    for shift_intervals in shifts:
        if not shift_intervals:
            continue
        shift_start = shift_intervals[0][0]
        shift_end = shift_intervals[-1][1]

        break_sec = sum((e - s).total_seconds() for s, e, wt, _m in shift_intervals if wt == 0)
        avail_sec = sum((e - s).total_seconds() for s, e, wt, _m in shift_intervals if wt == 1)
        work_only_sec = sum((e - s).total_seconds() for s, e, wt, _m in shift_intervals if wt == 2)
        driving_sec = sum((e - s).total_seconds() for s, e, wt, _m in shift_intervals if wt == 3)
        # Manual entries: only count intervals marked manual that fall AFTER the
        # first card-present interval (i.e. card was already inserted).  Pre-shift
        # manual entries (driver entering activities upon card insertion) are normal.
        first_card_present_idx = next(
            (i for i, (_, _, _, m) in enumerate(shift_intervals) if not m),
            len(shift_intervals),
        )
        manual_sec = sum(
            (e - s).total_seconds()
            for i, (s, e, wt, m) in enumerate(shift_intervals)
            if m and wt != 0 and i > first_card_present_idx
        )

        work_sec = work_only_sec + driving_sec + avail_sec
        work_minutes = int(round(work_sec / 60))
        break_minutes = int(round(break_sec / 60))
        avail_minutes = int(round(avail_sec / 60))
        driving_minutes = int(round(driving_sec / 60))
        work_only_minutes = int(round(work_only_sec / 60))
        manual_minutes = int(round(manual_sec / 60))
        duration_minutes = int(round((shift_end - shift_start).total_seconds() / 60))

        night_25, night_40 = calculate_shift_night_hours(shift_intervals, shift_start)
        total_work += work_minutes
        total_driving += driving_minutes
        total_break += break_minutes
        total_avail += avail_minutes
        total_n25 += night_25
        total_n40 += night_40
        total_manual += manual_minutes
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

        # Build driving and break segments for Art. 7 continuous driving checks
        driving_segments = []
        break_segments = []
        for s_start, s_end, wt, _m in shift_intervals:
            seg_min = int(round((s_end - s_start).total_seconds() / 60))
            if seg_min <= 0:
                continue
            seg = {
                'start': s_start.strftime('%Y-%m-%d %H:%M'),
                'end': s_end.strftime('%Y-%m-%d %H:%M'),
                'duration_minutes': seg_min,
            }
            if wt == 3:  # driving
                driving_segments.append(seg)
            elif wt == 0:  # break/rest
                break_segments.append(seg)

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
            'manual_minutes': manual_minutes,
            'manual_hm': minutes_to_hm(manual_minutes),
            'driving_segments': driving_segments,
            'break_segments': break_segments,
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
            'total_manual_hm': minutes_to_hm(total_manual),
            'total_manual_minutes': total_manual,
        },
        'shift_details': shift_details,
        'card_places': places,
        'card_events': card_events,
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
# Manual driver management
# ---------------------------------------------------------------------------


@app.route('/api/drivers/add', methods=['POST'])
@login_required
def api_add_driver():
    """Create a new driver folder in Dropbox."""
    payload = request.get_json(silent=True) or {}
    driver_name = (payload.get('name') or '').strip()
    if not driver_name:
        return jsonify({'error': 'Brak nazwy kierowcy'}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak połączenia z Dropbox'}), 500

    sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
    folder_path = f"{sync_folder}/{driver_name}"

    try:
        dbx.files_create_folder_v2(folder_path)
    except dropbox.exceptions.ApiError as e:
        if 'conflict' in str(e).lower() or 'path/conflict' in str(e).lower():
            return jsonify({'error': 'Folder już istnieje'}), 409
        return jsonify({'error': str(e)}), 500

    # Invalidate cache
    try:
        if os.path.exists(PORTAL_CACHE_FILE):
            os.unlink(PORTAL_CACHE_FILE)
    except Exception:
        pass

    _log_activity('add_driver', driver_name)
    return jsonify({'ok': True, 'path': folder_path})


@app.route('/api/reader/save-to-dropbox', methods=['POST'])
@login_required
def api_reader_save_to_dropbox():
    """Upload a .ddd file from the reader to the driver's Dropbox folder."""
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400

    file = request.files['file']
    driver_name = request.form.get('driver_name', '').strip()
    card_number = request.form.get('card_number', '').strip()

    if not driver_name:
        return jsonify({'error': 'Brak nazwy kierowcy'}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak połączenia z Dropbox'}), 500

    sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
    date_part = datetime.now().strftime('%Y-%m-%d')

    if card_number:
        fname = f"{card_number}_{date_part}.ddd"
    else:
        safe = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'file'
        fname = f"{safe}_{date_part}.ddd"

    dbx_path = f"{sync_folder}/{driver_name}/{fname}"

    try:
        file_data = file.read()
        dbx.files_upload(
            file_data,
            dbx_path,
            mode=dropbox.files.WriteMode.overwrite,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    # Invalidate cache
    try:
        if os.path.exists(PORTAL_CACHE_FILE):
            os.unlink(PORTAL_CACHE_FILE)
    except Exception:
        pass

    _log_activity('reader_save_to_dropbox', f"{driver_name} — {fname}")
    return jsonify({'ok': True, 'path': dbx_path, 'filename': fname})


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
        di = result.get('driver_info', {})
        _cache_card_expiry(di.get('card_number'), di.get('card_expiry_date'), di.get('driver_name', ''))
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
        di = result.get('driver_info', {})
        _cache_card_expiry(di.get('card_number'), di.get('card_expiry_date'), di.get('driver_name', ''))
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'tmp_path' in locals():
            os.unlink(tmp_path)


@app.route('/api/compare', methods=['POST'])
@login_required
def api_compare_drivers():
    """Compare shifts across multiple drivers. Accepts {files: [{path, driver_name, card_number}]}."""
    payload = request.get_json(silent=True) or {}
    files = payload.get('files', [])
    if not files or not isinstance(files, list):
        return jsonify({'error': 'files list required'}), 400
    if len(files) > 20:
        return jsonify({'error': 'Max 20 drivers'}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak połączenia z Dropbox'}), 500

    results = []
    for entry in files:
        file_path = entry.get('path', '')
        driver_name = entry.get('driver_name', '')
        card_number = entry.get('card_number', '')
        if not file_path:
            continue
        try:
            metadata, response = dbx.files_download(file_path)
            with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
                tmp.write(response.content)
                tmp_path = tmp.name
            data = parse_ddd_file(tmp_path)
            analysis = analyze_card(data)
            os.unlink(tmp_path)

            # Extract condensed shift data
            shifts = []
            for sh in analysis.get('shift_details', []):
                shifts.append({
                    'date': sh.get('shift_date', ''),
                    'weekday': sh.get('weekday', ''),
                    'start': sh.get('shift_start', ''),
                    'end': sh.get('shift_end', ''),
                    'duration_hm': sh.get('duration_hm', ''),
                    'work_minutes': sh.get('work_minutes', 0),
                })

            results.append({
                'driver_name': driver_name or analysis.get('driver_info', {}).get('driver_name', ''),
                'card_number': card_number,
                'shifts': shifts,
            })
        except Exception:
            results.append({
                'driver_name': driver_name,
                'card_number': card_number,
                'shifts': [],
                'error': 'Nie udało się przeanalizować pliku',
            })

    _log_activity('compare_drivers', f"{len(results)} drivers")
    return jsonify({'drivers': results})


@app.route('/api/settlement', methods=['POST'])
@login_required
def api_settlement():
    """Analyze all drivers for a given month. Returns full analysis per driver.

    Accepts {period: "YYYY-MM"} – downloads latest DDD file per driver from Dropbox,
    parses it, and filters shifts to the requested month.
    Uses ThreadPoolExecutor for parallel Dropbox downloads.
    """
    try:
        payload = request.get_json(silent=True) or {}
        period = payload.get('period', '')
        if not period or not re.match(r'^\d{4}-\d{2}$', period):
            return jsonify({'error': 'period (YYYY-MM) required'}), 400

        # Load drivers from cache or Dropbox
        cached = load_portal_cache()
        if cached:
            drivers_data = cached
        else:
            dbx = get_server_dropbox_client()
            if not dbx:
                return jsonify({'error': 'Brak połączenia z Dropbox'}), 500
            sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
            drivers_data = build_drivers_data(dbx, sync_folder)

        # Load all driver configs for personal_nr / diet settings
        conn = _get_db()
        all_configs = {}
        for row in conn.execute('SELECT * FROM driver_config').fetchall():
            all_configs[row['card_number']] = dict(row)
        conn.close()

        # Build list of drivers that have files to analyze
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
            """Download + parse + filter one driver. Each thread gets its own Dropbox client."""
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
                data = parse_ddd_file(tmp_path)
                analysis = analyze_card(data)
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
                # Double diet = two allowances per day (14€ + 14€)
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

        # Process drivers in parallel (up to 8 concurrent Dropbox downloads)
        results = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(process_driver, t): t for t in tasks}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    results.append(result)

        results.sort(key=lambda r: r['driver_name'])
        _log_activity('settlement', f"{period} – {len(results)} drivers")
        return jsonify({'period': period, 'drivers': results})
    except Exception as exc:
        return jsonify({'error': f'Settlement error: {str(exc)}'}), 500


@app.route('/api/driver-km', methods=['POST'])
@login_required
def api_driver_km():
    """Extract km (odometer) data from selected drivers' DDD files for a date range.

    Accepts {date_from: "YYYY-MM-DD", date_to: "YYYY-MM-DD", driver_names: [...]}.
    Downloads latest DDD file per driver from Dropbox, parses vehicle records
    with odometer_begin/end, and returns per-driver km summary.
    """
    try:
        payload = request.get_json(force=True)
        date_from = payload.get('date_from', '')
        date_to = payload.get('date_to', '')
        selected_drivers = payload.get('driver_names', [])

        if not date_from or not date_to:
            return jsonify({'error': 'date_from and date_to required (YYYY-MM-DD)'}), 400

        dbx = get_server_dropbox_client()
        if not dbx:
            return jsonify({'error': 'Brak połączenia z Dropbox'}), 500

        # Use the same driver listing as settlement/drivers pages
        cached = load_portal_cache()
        if cached:
            drivers_data = cached
        else:
            sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
            drivers_data = build_drivers_data(dbx, sync_folder)

        # Build task list: one task per selected driver with files
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
                data = parse_ddd_file(tmp_path)
                os.unlink(tmp_path)

                vehicles = get_vehicle_records(data)
                driver_info = get_driver_info(data)

                # Filter vehicle records to date range and calculate km
                period_records = []
                total_km = 0
                for v in vehicles:
                    first_use = v.get('first_use', '')[:10]
                    last_use = v.get('last_use', '')[:10]
                    if not first_use:
                        continue
                    # Check date range overlap: vehicle record overlaps [date_from, date_to]
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
                app.logger.warning(f'Driver km error for {task["driver_name"]}: {exc}')
                return None

        results = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(process_driver_km, t): t for t in tasks}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    results.append(result)

        results.sort(key=lambda r: r['driver_name'])
        _log_activity('driver_km', f"{date_from}–{date_to} – {len(results)} drivers")
        return jsonify({'date_from': date_from, 'date_to': date_to, 'drivers': results})
    except Exception as exc:
        return jsonify({'error': f'Driver km error: {str(exc)}'}), 500


@app.route('/api/export/datev-batch', methods=['POST'])
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
    from flask import Response
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


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

    # Stale drivers (sorted by days_since descending, those with data issues first)
    stale_drivers = []
    if cached:
        now = datetime.utcnow()
        for d in cached:
            ld = d.get('latest_download', '')
            days = None
            if ld:
                try:
                    cleaned = ld.replace('Z', '+00:00') if ld.endswith('Z') else ld
                    dt = datetime.fromisoformat(cleaned.replace('+00:00', ''))
                    days = (now - dt).days
                except Exception:
                    pass
            stale_drivers.append({
                'name': d.get('name', ''),
                'card_number': d.get('card_number', ''),
                'days_since': days,
                'latest_download': ld,
                'file_count': d.get('file_count', 0),
            })
        # Sort: null days first (no data), then highest days_since
        stale_drivers.sort(key=lambda x: (0 if x['days_since'] is None else 1, -(x['days_since'] or 9999)))

    # Expiring cards from driver_config cache
    expiring_cards = []
    try:
        conn = _get_db()
        rows = conn.execute(
            "SELECT card_number, driver_name, card_expiry_date FROM driver_config WHERE card_expiry_date != ''"
        ).fetchall()
        conn.close()
        today = datetime.utcnow().date()
        for row in rows:
            try:
                expiry = datetime.strptime(row[2], '%Y-%m-%d').date() if row[2] else None
                if expiry:
                    days_left = (expiry - today).days
                    expiring_cards.append({
                        'card_number': row[0],
                        'driver_name': row[1],
                        'card_expiry_date': row[2],
                        'days_left': days_left,
                    })
            except Exception:
                pass
        expiring_cards.sort(key=lambda x: x['days_left'])
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
        'stale_drivers': stale_drivers,
        'expiring_cards': expiring_cards,
    })


@app.route('/api/dashboard/scan-expiry', methods=['POST'])
@login_required
def api_scan_card_expiry():
    """Bulk scan all drivers' latest DDD files to cache card expiry dates."""
    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak połączenia z Dropbox'}), 500

    cached = load_portal_cache()
    if not cached:
        return jsonify({'error': 'Brak danych kierowców'}), 400

    results = []
    for driver in cached:
        files = driver.get('files', [])
        if not files:
            continue
        # Use the latest file
        latest = files[0]
        fpath = latest.get('path', '')
        if not fpath:
            continue
        try:
            _, response = dbx.files_download(fpath)
            with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
                tmp.write(response.content)
                tmp_path = tmp.name
            data = parse_ddd_file(tmp_path)
            info = get_driver_info(data)
            os.unlink(tmp_path)
            if info.get('card_number') and info.get('card_expiry_date'):
                _cache_card_expiry(info['card_number'], info['card_expiry_date'], info.get('driver_name', ''))
                results.append({
                    'driver': driver.get('name', ''),
                    'card_number': info['card_number'],
                    'card_expiry_date': info['card_expiry_date'],
                })
        except Exception:
            if 'tmp_path' in locals():
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
            continue

    return jsonify({'scanned': len(results), 'results': results})


# ---------------------------------------------------------------------------
# Monthly days API (vacation / sick per driver per month)
# ---------------------------------------------------------------------------


@app.route('/api/driver-monthly/<card_number>/<period>')
@login_required
def api_get_monthly_days(card_number, period):
    """Get vacation/sick days for a driver in a given month (period=YYYY-MM)."""
    conn = _get_db()
    row = conn.execute(
        "SELECT vacation_days, sick_days, overtime_hm, notes, absence_days FROM driver_monthly_days WHERE card_number = ? AND period = ?",
        (card_number, period),
    ).fetchone()
    conn.close()
    if row:
        import json as _json
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


@app.route('/api/driver-monthly/<card_number>/<period>', methods=['POST'])
@login_required
def api_set_monthly_days(card_number, period):
    """Set vacation/sick days for a driver in a given month."""
    import json as _json
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


# --- Driver config ---

@app.route('/api/driver-config')
@login_required
def api_list_driver_configs():
    """List all driver configs."""
    conn = _get_db()
    rows = conn.execute('SELECT * FROM driver_config ORDER BY driver_name').fetchall()
    conn.close()
    return jsonify({'configs': [dict(r) for r in rows]})


@app.route('/api/driver-config/<card_number>')
@login_required
def api_get_driver_config(card_number):
    """Get config for a specific driver by card number."""
    conn = _get_db()
    row = conn.execute('SELECT * FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()
    conn.close()
    if row:
        return jsonify(dict(row))
    return jsonify({
        'card_number': card_number,
        'driver_name': '',
        'personal_nr': '',
        'double_diet': 0,
        'diet_rate': 14.0,
        'notes': '',
    })


def _sanitize_text(val: str, max_len: int = 200) -> str:
    """Strip and limit text input length."""
    return str(val).strip()[:max_len]


@app.route('/api/driver-config', methods=['POST'])
@admin_required
def api_upsert_driver_config():
    """Create or update a driver config."""
    data = request.get_json(silent=True) or {}
    card_number = _sanitize_text(data.get('card_number', ''), 50)
    if not card_number:
        return jsonify({'error': 'card_number required'}), 400
    if not re.match(r'^[A-Za-z0-9_ .\-/]+$', card_number):
        return jsonify({'error': 'Invalid card_number format'}), 400

    driver_name = _sanitize_text(data.get('driver_name', ''), 200)
    personal_nr = _sanitize_text(data.get('personal_nr', ''), 50)
    notes = _sanitize_text(data.get('notes', ''), 500)
    double_diet = 1 if data.get('double_diet') else 0

    try:
        diet_rate = float(data.get('diet_rate', 14.0))
        if diet_rate < 0 or diet_rate > 999:
            diet_rate = 14.0
    except (ValueError, TypeError):
        diet_rate = 14.0

    now = datetime.now(UTC).isoformat()
    conn = _get_db()
    existing = conn.execute('SELECT * FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()

    changes = []
    if existing:
        old = dict(existing)
        field_map = {'driver_name': driver_name, 'personal_nr': personal_nr, 'double_diet': double_diet, 'diet_rate': diet_rate, 'notes': notes}
        for field, new_val in field_map.items():
            old_val = old.get(field, '')
            if str(old_val) != str(new_val):
                changes.append({'field': field, 'old': old_val, 'new': new_val})
        conn.execute('''
            UPDATE driver_config SET
                driver_name = ?, personal_nr = ?, double_diet = ?,
                diet_rate = ?, notes = ?, updated_at = ?
            WHERE card_number = ?
        ''', (driver_name, personal_nr, double_diet, diet_rate, notes, now, card_number))
    else:
        changes.append({'field': '*', 'old': '', 'new': 'created'})
        conn.execute('''
            INSERT INTO driver_config (card_number, driver_name, personal_nr, double_diet, diet_rate, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (card_number, driver_name, personal_nr, double_diet, diet_rate, notes, now, now))

    conn.commit()
    conn.close()
    _log_activity('save_driver_config', f"{card_number} — {driver_name}")
    _log_config_change('save_driver_config', f"{card_number} — {driver_name}", card_number=card_number, driver_name=driver_name, changes=changes)
    return jsonify({'ok': True})


@app.route('/api/driver-config/bulk', methods=['POST'])
@admin_required
def api_bulk_driver_config():
    """Bulk update driver configs. Expects {card_numbers: [...], updates: {...}}."""
    data = request.get_json(silent=True) or {}
    card_numbers = data.get('card_numbers', [])
    updates = data.get('updates', {})

    if not card_numbers or not isinstance(card_numbers, list):
        return jsonify({'error': 'card_numbers list required'}), 400
    if len(card_numbers) > 200:
        return jsonify({'error': 'Too many card numbers (max 200)'}), 400
    if not updates:
        return jsonify({'error': 'updates required'}), 400

    now = datetime.now(UTC).isoformat()
    conn = _get_db()
    count = 0

    for cn in card_numbers:
        cn = _sanitize_text(str(cn), 50)
        if not cn:
            continue
        existing = conn.execute('SELECT id FROM driver_config WHERE card_number = ?', (cn,)).fetchone()
        if existing:
            # Build partial update
            sets = ['updated_at = ?']
            vals = [now]
            if 'double_diet' in updates:
                sets.append('double_diet = ?')
                vals.append(1 if updates['double_diet'] else 0)
            if 'diet_rate' in updates:
                try:
                    rate = float(updates['diet_rate'])
                    if 0 <= rate <= 999:
                        sets.append('diet_rate = ?')
                        vals.append(rate)
                except (ValueError, TypeError):
                    pass
            if 'personal_nr' in updates:
                sets.append('personal_nr = ?')
                vals.append(_sanitize_text(str(updates['personal_nr']), 50))
            if 'notes' in updates:
                sets.append('notes = ?')
                vals.append(_sanitize_text(str(updates['notes']), 500))
            vals.append(cn)
            conn.execute(f"UPDATE driver_config SET {', '.join(sets)} WHERE card_number = ?", vals)
        else:
            # Create with defaults + updates
            double_diet = 1 if updates.get('double_diet') else 0
            try:
                diet_rate = float(updates.get('diet_rate', 14.0))
                if diet_rate < 0 or diet_rate > 999:
                    diet_rate = 14.0
            except (ValueError, TypeError):
                diet_rate = 14.0
            conn.execute('''
                INSERT INTO driver_config (card_number, driver_name, personal_nr, double_diet, diet_rate, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                cn, '', _sanitize_text(str(updates.get('personal_nr', '')), 50),
                double_diet, diet_rate, _sanitize_text(str(updates.get('notes', '')), 500),
                now, now,
            ))
        count += 1

    conn.commit()
    conn.close()
    _log_activity('bulk_driver_config', f"{count} drivers updated")
    _log_config_change('bulk_driver_config', f"{count} drivers updated")
    return jsonify({'ok': True, 'updated': count})


@app.route('/api/driver-config/<int:config_id>', methods=['DELETE'])
@admin_required
def api_delete_driver_config(config_id):
    """Delete a driver config."""
    conn = _get_db()
    conn.execute('DELETE FROM driver_config WHERE id = ?', (config_id,))
    conn.commit()
    conn.close()
    _log_activity('delete_driver_config', f"id={config_id}")
    _log_config_change('delete_driver_config', f"id={config_id}")
    return jsonify({'ok': True})


# --- Config audit log ---

@app.route('/api/admin/config-history')
@admin_required
def api_config_history():
    """Return recent config change audit log entries."""
    card_number = request.args.get('card_number', '')
    limit = min(int(request.args.get('limit', 100)), 500)
    conn = _get_db()
    if card_number:
        rows = conn.execute(
            'SELECT * FROM config_audit_log WHERE card_number = ? ORDER BY changed_at DESC LIMIT ?',
            (card_number, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            'SELECT * FROM config_audit_log ORDER BY changed_at DESC LIMIT ?',
            (limit,)
        ).fetchall()
    conn.close()
    entries = [dict(r) for r in rows]
    return jsonify({'entries': entries})


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
    _log_config_change('change_password', f"{target} password changed")
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
    _log_config_change('update_config', ', '.join(data.keys()))
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
# Vehicle activity (Samsara GPS / engine data for controlling)
# ---------------------------------------------------------------------------


@app.route('/api/vehicles', methods=['GET'])
@admin_required
def api_vehicles_list():
    """List vehicles from Samsara."""
    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Samsara API not configured'}), 400

    headers = {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}
    vehicles = []
    after = None

    for _ in range(20):  # max pages
        params = {'limit': 100}
        if after:
            params['after'] = after
        try:
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/vehicles',
                headers=headers, params=params, timeout=15,
            )
            if resp.status_code != 200:
                return jsonify({'error': f'Samsara API error: {resp.status_code}'}), 502
            data = resp.json()
        except Exception as e:
            return jsonify({'error': str(e)}), 502

        for v in data.get('data', []):
            vehicles.append({
                'id': v.get('id', ''),
                'name': v.get('name', ''),
                'vin': v.get('vin', ''),
                'serial': v.get('serial', ''),
                'license_plate': v.get('licensePlate', ''),
            })
        pag = data.get('pagination', {})
        if pag.get('hasNextPage') and pag.get('endCursor'):
            after = pag['endCursor']
        else:
            break

    _log_activity('vehicles_list', f'{len(vehicles)} vehicles')
    return jsonify({'vehicles': vehicles})


@app.route('/api/vehicles/activity', methods=['POST'])
@admin_required
def api_vehicles_activity():
    """
    Fetch vehicle activity from Samsara using trips/stream endpoint.
    Returns daily breakdown: date, start/end time, duration, distance.
    """
    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Samsara API not configured'}), 400

    body = request.get_json(force=True)
    period = body.get('period', '')  # "2026-03"
    vehicle_ids = body.get('vehicle_ids', [])  # required

    if not period or len(period) != 7:
        return jsonify({'error': 'Invalid period (expected YYYY-MM)'}), 400

    if not vehicle_ids:
        return jsonify({'error': 'No vehicle selected'}), 400

    # --- Check cache ---
    cache_key = (period, tuple(sorted(vehicle_ids)))
    cached = VEHICLE_ACTIVITY_CACHE.get(cache_key)
    if cached:
        cache_ts, cache_data = cached
        if (datetime.now() - cache_ts).total_seconds() < VEHICLE_ACTIVITY_CACHE_TTL:
            app.logger.info('Vehicle activity cache hit for %s', cache_key)
            return jsonify(cache_data)

    year, month = int(period[:4]), int(period[5:7])
    from calendar import monthrange
    _, last_day = monthrange(year, month)
    start_time = f'{period}-01T00:00:00Z'
    end_time = f'{period}-{last_day:02d}T23:59:59Z'

    headers = {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}
    ids_param = ','.join(vehicle_ids[:50])

    debug_info = {'api_calls': 0, 'raw_trips': 0, 'errors': []}

    # ---- Helper functions for parallel fetching ----

    def _fetch_trips():
        """Fetch trips from trips/stream endpoint."""
        trips = []
        info = {'api_calls': 0, 'raw_trips': 0, 'errors': []}
        after_cursor = None
        for _ in range(200):
            params = {
                'ids': ids_param,
                'startTime': start_time,
                'endTime': end_time,
                'queryBy': 'tripStartTime',
                'completionStatus': 'completed',
                'includeAsset': 'true',
            }
            if after_cursor:
                params['after'] = after_cursor
            info['api_calls'] += 1
            try:
                resp = http_requests.get(
                    f'{SAMSARA_API_BASE}/trips/stream',
                    headers=headers, params=params, timeout=30,
                )
                if resp.status_code != 200:
                    info['errors'].append(f'HTTP {resp.status_code}: {resp.text[:500] if resp.text else ""}')
                    break
                data = resp.json()
            except Exception as exc:
                info['errors'].append(str(exc))
                break
            batch = data.get('data', [])
            info['raw_trips'] += len(batch)
            trips.extend(batch)
            pag = data.get('pagination', {})
            if pag.get('hasNextPage') and pag.get('endCursor'):
                after_cursor = pag['endCursor']
            else:
                break
        return trips, info

    def _fetch_stats():
        """Fetch OBD odometer / GPS distance stats."""
        all_stats = {vid: [] for vid in vehicle_ids}
        info = {'api_calls': 0, 'errors': []}
        stats_after = None
        for _ in range(50):
            stat_params = {
                'vehicleIds': ids_param,
                'types': 'obdOdometerMeters,gpsDistanceMeters',
                'startTime': start_time,
                'endTime': end_time,
            }
            if stats_after:
                stat_params['after'] = stats_after
            info['api_calls'] += 1
            sresp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/vehicles/stats/history',
                headers=headers, params=stat_params, timeout=30,
            )
            if sresp.status_code != 200:
                info['errors'].append(f'stats/history HTTP {sresp.status_code}: {sresp.text[:300]}')
                break
            sdata = sresp.json()
            for entry in sdata.get('data', []):
                vid = entry.get('id', '')
                if vid not in all_stats:
                    all_stats[vid] = []
                for stat_type in ['obdOdometerMeters', 'gpsDistanceMeters']:
                    for point in entry.get(stat_type, []):
                        val = point.get('value', 0) or 0
                        ts = point.get('time', '')
                        if val and ts:
                            all_stats[vid].append({
                                'type': stat_type,
                                'value': float(val),
                                'time': ts,
                            })
            spag = sdata.get('pagination', {})
            if spag.get('hasNextPage') and spag.get('endCursor'):
                stats_after = spag['endCursor']
            else:
                break

        # Calculate daily km from stats
        stats_daily = {}
        for vid, points in all_stats.items():
            if not points:
                continue
            obd_pts = [p for p in points if p['type'] == 'obdOdometerMeters']
            gps_pts = [p for p in points if p['type'] == 'gpsDistanceMeters']
            use_pts = obd_pts if obd_pts else gps_pts
            if not use_pts:
                continue
            day_readings = {}
            for p in use_pts:
                try:
                    dt = datetime.fromisoformat(p['time'].replace('Z', '+00:00')).astimezone(CET)
                    dk = dt.strftime('%Y-%m-%d')
                    day_readings.setdefault(dk, []).append(p['value'])
                except Exception:
                    continue
            if vid not in stats_daily:
                stats_daily[vid] = {}
            sorted_days = sorted(day_readings.keys())
            for dk in sorted_days:
                readings = day_readings[dk]
                if len(readings) >= 2:
                    stats_daily[vid][dk] = round((max(readings) - min(readings)) / 1000, 1)
                elif len(readings) == 1:
                    idx = sorted_days.index(dk)
                    if idx > 0:
                        prev_max = max(day_readings[sorted_days[idx - 1]])
                        diff = readings[0] - prev_max
                        if diff > 0:
                            stats_daily[vid][dk] = round(diff / 1000, 1)

        has_obd = any(p['type'] == 'obdOdometerMeters' for pts in all_stats.values() for p in pts)
        has_gps = any(p['type'] == 'gpsDistanceMeters' for pts in all_stats.values() for p in pts)
        info['stats_vehicles'] = len([v for v in all_stats.values() if v])
        info['stats_daily_entries'] = sum(len(d) for d in stats_daily.values())
        info['stats_source'] = 'obdOdometer' if has_obd else 'gpsDistance' if has_gps else 'none'
        return stats_daily, info

    def _fetch_gps():
        """Fetch GPS breadcrumbs for location + distance calculation."""
        daily_location = {}
        daily_points = {}
        daily_km = {}
        info = {'api_calls': 0, 'errors': [], 'gps_points': 0}
        gps_after = None
        for _ in range(100):
            gps_params = {
                'vehicleIds': ids_param,
                'types': 'gps',
                'startTime': start_time,
                'endTime': end_time,
            }
            if gps_after:
                gps_params['after'] = gps_after
            info['api_calls'] += 1
            gresp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/vehicles/stats/history',
                headers=headers, params=gps_params, timeout=30,
            )
            if gresp.status_code != 200:
                info['errors'].append(f'gps/history HTTP {gresp.status_code}: {gresp.text[:300]}')
                break
            gdata = gresp.json()
            for entry in gdata.get('data', []):
                vid = entry.get('id', '')
                if vid not in daily_location:
                    daily_location[vid] = {}
                for gps_point in entry.get('gps', []):
                    ts = gps_point.get('time', '')
                    if not ts:
                        continue
                    info['gps_points'] += 1
                    try:
                        dt = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(CET)
                        dk = dt.strftime('%Y-%m-%d')
                    except Exception:
                        continue
                    lat = gps_point.get('latitude', 0)
                    lng = gps_point.get('longitude', 0)
                    reverse_geo = gps_point.get('reverseGeo', {}) or {}
                    address = reverse_geo.get('formattedLocation', '')
                    if lat and lng:
                        daily_points.setdefault(vid, {}).setdefault(dk, []).append((ts, lat, lng))
                    existing = daily_location[vid].get(dk)
                    if not existing or ts > existing.get('time', ''):
                        daily_location[vid][dk] = {'address': address, 'lat': lat, 'lng': lng, 'time': ts}
            gpag = gdata.get('pagination', {})
            if gpag.get('hasNextPage') and gpag.get('endCursor'):
                gps_after = gpag['endCursor']
            else:
                break

        # Calculate daily distance from GPS breadcrumbs
        for vid, day_pts in daily_points.items():
            if vid not in daily_km:
                daily_km[vid] = {}
            for dk, pts in day_pts.items():
                if len(pts) < 2:
                    continue
                pts.sort(key=lambda p: p[0])
                total_dist = 0.0
                for i in range(1, len(pts)):
                    d = _haversine_km(pts[i-1][1], pts[i-1][2], pts[i][1], pts[i][2])
                    if d < 10.0:
                        total_dist += d
                if total_dist > 0.1:
                    daily_km[vid][dk] = round(total_dist, 1)

        info['gps_vehicles_with_location'] = len([v for v in daily_location.values() if v])
        info['gps_distance_days'] = sum(len(d) for d in daily_km.values())
        return daily_location, daily_km, info

    # ---- Run all 3 Samsara fetches in parallel ----
    with ThreadPoolExecutor(max_workers=3) as executor:
        future_trips = executor.submit(_fetch_trips)
        future_stats = executor.submit(_fetch_stats)
        future_gps = executor.submit(_fetch_gps)

    all_trips, trips_info = future_trips.result()
    debug_info['api_calls'] += trips_info['api_calls']
    debug_info['raw_trips'] = trips_info['raw_trips']
    debug_info['errors'].extend(trips_info['errors'])

    stats_daily_km, stats_info = future_stats.result()
    debug_info['api_calls'] += stats_info['api_calls']
    debug_info['errors'].extend(stats_info.get('errors', []))
    debug_info['stats_vehicles'] = stats_info.get('stats_vehicles', 0)
    debug_info['stats_daily_entries'] = stats_info.get('stats_daily_entries', 0)
    debug_info['stats_source'] = stats_info.get('stats_source', 'none')

    gps_daily_location, gps_daily_km, gps_info = future_gps.result()
    debug_info['api_calls'] += gps_info['api_calls']
    debug_info['errors'].extend(gps_info.get('errors', []))
    debug_info['gps_points'] = gps_info.get('gps_points', 0)
    debug_info['gps_vehicles_with_location'] = gps_info.get('gps_vehicles_with_location', 0)
    debug_info['gps_distance_days'] = gps_info.get('gps_distance_days', 0)

    # ---------- Group trips by vehicle and then by day ----------
    # Trip object structure (Samsara) may vary:
    #   tripStartTime, tripEndTime, distanceMeters (or other field names),
    #   startLocation{latitude,longitude,formattedAddress},
    #   endLocation{latitude,longitude,formattedAddress},
    #   asset{id,name}
    vehicle_trips = {}  # vid -> list of trips

    # Log a sample raw trip for debugging
    if all_trips:
        sample = all_trips[0]
        debug_info['sample_trip_keys'] = list(sample.keys())
        # Include sample values for distance-related fields
        for k in sample.keys():
            if 'dist' in k.lower() or 'meter' in k.lower() or 'mile' in k.lower() or 'km' in k.lower() or 'odometer' in k.lower():
                debug_info[f'sample_{k}'] = sample.get(k)

    for trip in all_trips:
        asset = trip.get('asset', {})
        vid = asset.get('id', '')
        if not vid:
            vid = vehicle_ids[0] if len(vehicle_ids) == 1 else ''
        if vid not in vehicle_trips:
            vehicle_trips[vid] = {
                'name': asset.get('name', vid),
                'trips': [],
            }
        vehicle_trips[vid]['trips'].append(trip)

    # Process each vehicle's trips into daily summaries
    results = []

    for vid, vdata in vehicle_trips.items():
        daily = {}  # date_str -> {first_start, last_end, total_meters, trips_count, end_address}
        vid_stats = stats_daily_km.get(vid, {})

        for trip in vdata['trips']:
            t_start = trip.get('tripStartTime', '')
            t_end = trip.get('tripEndTime', '')
            # Try multiple field names for distance
            dist = (
                trip.get('distanceMeters')
                or trip.get('distance_meters')
                or trip.get('distanceM')
                or trip.get('distance')
                or 0
            )
            dist = float(dist) if dist else 0

            if not t_start:
                continue

            try:
                dt_start = datetime.fromisoformat(
                    t_start.replace('Z', '+00:00')
                ).astimezone(CET)
            except Exception:
                continue

            try:
                dt_end = datetime.fromisoformat(
                    t_end.replace('Z', '+00:00')
                ).astimezone(CET) if t_end else dt_start
            except Exception:
                dt_end = dt_start

            day_key = dt_start.strftime('%Y-%m-%d')

            # End location address
            end_loc = trip.get('endLocation', {})
            end_addr = end_loc.get('formattedAddress', '') if end_loc else ''

            if day_key not in daily:
                daily[day_key] = {
                    'first_start': dt_start,
                    'last_end': dt_end,
                    'total_meters': float(dist),
                    'trips_count': 1,
                    'end_address': end_addr,
                }
            else:
                d = daily[day_key]
                if dt_start < d['first_start']:
                    d['first_start'] = dt_start
                if dt_end > d['last_end']:
                    d['last_end'] = dt_end
                    d['end_address'] = end_addr
                d['total_meters'] += float(dist)
                d['trips_count'] += 1

        # Build daily entries
        days = []
        total_km = 0.0
        distance_source = 'trips'

        for day_key in sorted(daily.keys()):
            d = daily[day_key]
            start_dt = d['first_start']
            end_dt = d['last_end']
            trip_dist_km = round(d['total_meters'] / 1000, 1)
            stats_dist_km = vid_stats.get(day_key, 0)

            gps_dist_km = gps_daily_km.get(vid, {}).get(day_key, 0)

            # Use trip distance if available, then stats odometer, then GPS breadcrumbs
            if trip_dist_km > 0:
                dist_km = trip_dist_km
            elif stats_dist_km > 0:
                dist_km = stats_dist_km
                distance_source = 'stats'
            elif gps_dist_km > 0:
                dist_km = gps_dist_km
                distance_source = 'gps'
            else:
                dist_km = 0
            total_km += dist_km

            dur_min = int((end_dt - start_dt).total_seconds() / 60) if end_dt > start_dt else 0
            dur_h = dur_min // 60
            dur_m = dur_min % 60

            # Last location: prefer trip endLocation, fall back to GPS
            last_loc = d['end_address']
            if not last_loc:
                gps_loc = gps_daily_location.get(vid, {}).get(day_key, {})
                last_loc = gps_loc.get('address', '')

            days.append({
                'date': day_key,
                'begin_driving': start_dt.strftime('%Y-%m-%d %H:%M'),
                'last_driving': end_dt.strftime('%Y-%m-%d %H:%M'),
                'duration_h': dur_h,
                'duration_m': dur_m,
                'duration_hm': f'{dur_h}h' if dur_m == 0 else f'{dur_h}h {dur_m}m',
                'duration_minutes': dur_min,
                'distance_km': dist_km,
                'trips_count': d['trips_count'],
                'last_location': last_loc,
            })

        # If all trip distances were 0, try to fill from stats, then GPS
        if total_km == 0 and vid_stats:
            distance_source = 'stats'
            total_km = 0.0
            for day_entry in days:
                sk = vid_stats.get(day_entry['date'], 0)
                if sk > 0:
                    day_entry['distance_km'] = sk
                    total_km += sk
            total_km = round(total_km, 1)

        if total_km == 0 and vid in gps_daily_km and gps_daily_km[vid]:
            distance_source = 'gps'
            total_km = 0.0
            for day_entry in days:
                gk = gps_daily_km.get(vid, {}).get(day_entry['date'], 0)
                if gk > 0:
                    day_entry['distance_km'] = gk
                    total_km += gk
            total_km = round(total_km, 1)

        results.append({
            'vehicle_id': vid,
            'vehicle_name': vdata['name'],
            'days': days,
            'total_km': round(total_km, 1),
            'active_days': len(days),
            'distance_source': distance_source,
        })

    # Add vehicles that have stats data but no trips
    for vid in vehicle_ids:
        if vid not in vehicle_trips and vid in stats_daily_km and stats_daily_km[vid]:
            vid_stats = stats_daily_km[vid]
            vname = vid  # frontend maps to real name from vehicle list

            days = []
            total_km = 0.0
            for day_key in sorted(vid_stats.keys()):
                sk = vid_stats[day_key]
                if sk > 0:
                    gps_loc = gps_daily_location.get(vid, {}).get(day_key, {})
                    days.append({
                        'date': day_key,
                        'begin_driving': '',
                        'last_driving': '',
                        'duration_h': 0,
                        'duration_m': 0,
                        'duration_hm': '-',
                        'duration_minutes': 0,
                        'distance_km': sk,
                        'trips_count': 0,
                        'last_location': gps_loc.get('address', ''),
                    })
                    total_km += sk

            if days:
                results.append({
                    'vehicle_id': vid,
                    'vehicle_name': vname,
                    'days': days,
                    'total_km': round(total_km, 1),
                    'active_days': len(days),
                    'distance_source': 'stats',
                })

    # Add vehicles that have only GPS data (no trips, no stats)
    vids_with_results = {r['vehicle_id'] for r in results}
    for vid in vehicle_ids:
        if vid not in vids_with_results and vid in gps_daily_km and gps_daily_km[vid]:
            vname = vid
            days = []
            total_km = 0.0
            for day_key in sorted(gps_daily_km[vid].keys()):
                gk = gps_daily_km[vid][day_key]
                if gk > 0:
                    gps_loc = gps_daily_location.get(vid, {}).get(day_key, {})
                    days.append({
                        'date': day_key,
                        'begin_driving': '',
                        'last_driving': '',
                        'duration_h': 0,
                        'duration_m': 0,
                        'duration_hm': '-',
                        'duration_minutes': 0,
                        'distance_km': gk,
                        'trips_count': 0,
                        'last_location': gps_loc.get('address', ''),
                    })
                    total_km += gk

            if days:
                results.append({
                    'vehicle_id': vid,
                    'vehicle_name': vname,
                    'days': days,
                    'total_km': round(total_km, 1),
                    'active_days': len(days),
                    'distance_source': 'gps',
                })

    results.sort(key=lambda r: r['vehicle_name'])

    debug_info['vehicles_with_data'] = len(results)
    debug_info['total_days'] = sum(r['active_days'] for r in results)
    _log_activity('vehicles_activity', f'{period}: {len(all_trips)} trips, {len(results)} vehicles')

    # Save to cache
    response_data = {'period': period, 'vehicles': results, 'debug': debug_info}
    VEHICLE_ACTIVITY_CACHE[cache_key] = (datetime.now(), response_data)
    # Evict old cache entries
    now = datetime.now()
    stale = [k for k, (ts, _) in VEHICLE_ACTIVITY_CACHE.items()
             if (now - ts).total_seconds() > VEHICLE_ACTIVITY_CACHE_TTL * 2]
    for k in stale:
        VEHICLE_ACTIVITY_CACHE.pop(k, None)

    return jsonify(response_data)


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
# Health endpoint
# ---------------------------------------------------------------------------

_app_start_time = datetime.now(UTC)

@app.route('/api/health')
def health():
    uptime = (datetime.now(UTC) - _app_start_time).total_seconds()
    db_ok = False
    try:
        conn = _get_db()
        conn.execute('SELECT 1')
        conn.close()
        db_ok = True
    except Exception:
        pass
    return jsonify({
        'status': 'ok' if db_ok else 'degraded',
        'uptime_seconds': int(uptime),
        'database': db_ok,
    })


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
