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
from flask import Flask, render_template, request, jsonify, redirect, session, url_for
from zoneinfo import ZoneInfo

UTC = ZoneInfo('UTC')
CET = ZoneInfo('Europe/Berlin')

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'ddd-parser-secret-key-change-me')

DDDPARSER_PATH = os.environ.get('DDDPARSER_PATH', 'dddparser')

# Portal password
PORTAL_PASSWORD = os.environ.get('PORTAL_PASSWORD', 'lts2025')

# Dropbox OAuth2 config
DROPBOX_APP_KEY = os.environ.get('DROPBOX_APP_KEY', 'j9ntkihedd9495i')
DROPBOX_APP_SECRET = os.environ.get('DROPBOX_APP_SECRET', 'd3hr43reha9kky8')
DROPBOX_REDIRECT_URI = os.environ.get('DROPBOX_REDIRECT_URI', 'https://dd.ltslog.de/dropbox/callback')

# Dropbox refresh token for server-side access (from samsara_sync)
DROPBOX_REFRESH_TOKEN = os.environ.get('DROPBOX_REFRESH_TOKEN', '')

# Samsara API config
SAMSARA_API_TOKEN = os.environ.get('SAMSARA_API_TOKEN', '')
SAMSARA_API_BASE = 'https://api.eu.samsara.com'


def login_required(f):
    """Decorator to require login for routes."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            if request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


def get_server_dropbox_client():
    """Get a Dropbox client using the server-side refresh token."""
    if not DROPBOX_REFRESH_TOKEN:
        return None
    try:
        dbx = dropbox.Dropbox(
            oauth2_refresh_token=DROPBOX_REFRESH_TOKEN,
            app_key=DROPBOX_APP_KEY,
            app_secret=DROPBOX_APP_SECRET,
        )
        return dbx
    except Exception:
        return None


def get_dropbox_auth_flow():
    """Create a Dropbox OAuth2 flow."""
    return dropbox.DropboxOAuth2Flow(
        consumer_key=DROPBOX_APP_KEY,
        consumer_secret=DROPBOX_APP_SECRET,
        redirect_uri=None,  # Will be set dynamically
        session=session,
        csrf_token_session_key='dropbox-csrf-token',
    )


def get_dropbox_client():
    """Get an authenticated Dropbox client from session token."""
    token = session.get('dropbox_token')
    if not token:
        return None
    try:
        dbx = dropbox.Dropbox(token)
        dbx.users_get_current_account()
        return dbx
    except AuthError:
        session.pop('dropbox_token', None)
        return None


def parse_ddd_file(file_path):
    """Parse a DDD file using tachoparser and return JSON data."""
    result = subprocess.run(
        [DDDPARSER_PATH, '-card', '-format', '-input', file_path],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Parser error: {result.stderr}")
    return json.loads(result.stdout)


def get_driver_info(data):
    """Extract driver name and card number from parsed data."""
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
    """Extract decoded activity daily records from parsed data."""
    records = []
    for key in ['card_driver_activity_1', 'card_driver_activity_2']:
        activity = data.get(key)
        if activity:
            recs = activity.get('decoded_activity_daily_records') or []
            records.extend(recs)
    return records


def get_vehicle_records(data):
    """Extract vehicle usage records from parsed data."""
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
            vehicles.append({
                'plate': plate,
                'first_use': first_use,
                'last_use': last_use,
            })
    vehicles.sort(key=lambda v: v.get('first_use', ''))
    return vehicles


def parse_date_safe(date_str):
    """Parse a date string safely, handling various formats."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def minutes_to_hm(minutes):
    """Convert minutes to H:MM format."""
    h = minutes // 60
    m = minutes % 60
    return f"{h}:{m:02d}"


def minutes_to_decimal(minutes):
    """Convert minutes to decimal hours."""
    return round(minutes / 60, 2)


def build_timeline(records):
    """Build continuous timeline of (start_dt, end_dt, work_type) from daily records.

    Tachograph data is stored in UTC. We convert to Europe/Berlin (CET/CEST)
    so that night bonus windows align with local German time.
    """
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
    """Merge consecutive intervals of same work_type."""
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
    """Detect shifts from continuous timeline.

    A shift is a group of activity intervals separated by rest >= min_rest_hours.
    Short breaks within a shift are included in the shift.
    """
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
                # Daily rest boundary - end current shift
                if current:
                    shifts.append(current)
                    current = []
                continue
        # Short break or work - part of current shift
        current.append((start, end, wt))

    if current:
        shifts.append(current)

    return shifts


def calculate_shift_night_hours(intervals, shift_start):
    """Calculate night 25% and 40% hours for shift intervals.

    Night ranges (all activity types including breaks):
      - 22:00-06:00 is the full night window
      - 22:00-24:00 => always 25%
      - 00:00-04:00 => 40% if shift started before 00:00 of that day, else 25%
      - 04:00-06:00 => always 25%
      - A given minute is either 25% or 40%, never both

    Returns (night_25_minutes, night_40_minutes).
    """
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
            nr_start = day_base + timedelta(hours=22)
            nr_end = day_base + timedelta(hours=24)
            o_start = max(current, nr_start)
            o_end = min(chunk_end, nr_end)
            if o_end > o_start:
                night_25_sec += (o_end - o_start).total_seconds()

            # 00:00-04:00 => 40% if shift started before midnight (this day), else 25%
            nr_start = day_base
            nr_end = day_base + timedelta(hours=4)
            o_start = max(current, nr_start)
            o_end = min(chunk_end, nr_end)
            if o_end > o_start:
                secs = (o_end - o_start).total_seconds()
                # Shift started before 00:00 of this calendar day
                if shift_start < day_base:
                    night_40_sec += secs
                else:
                    night_25_sec += secs

            # 04:00-06:00 => always 25%
            nr_start = day_base + timedelta(hours=4)
            nr_end = day_base + timedelta(hours=6)
            o_start = max(current, nr_start)
            o_end = min(chunk_end, nr_end)
            if o_end > o_start:
                night_25_sec += (o_end - o_start).total_seconds()

            current = next_day

    return int(round(night_25_sec / 60)), int(round(night_40_sec / 60))


def analyze_card(data):
    """Analyze driver card data using shift-based detection.

    Builds a continuous timeline from all daily records, detects shifts
    (separated by rest >= 9h), and calculates work time, night hours,
    and vehicle usage per shift. Matches GloboFleet behavior.
    """
    driver_info = get_driver_info(data)
    records = get_activity_records(data)
    vehicles = get_vehicle_records(data)

    timeline = build_timeline(records)
    shifts = detect_shifts(timeline)

    shift_details = []
    total_work_minutes = 0
    total_driving_minutes = 0
    total_break_minutes = 0
    total_avail_minutes = 0
    total_night_25_minutes = 0
    total_night_40_minutes = 0
    diet_count = 0

    for shift_intervals in shifts:
        if not shift_intervals:
            continue

        shift_start = shift_intervals[0][0]
        shift_end = shift_intervals[-1][1]

        # Tachograph activity types: 0=break/rest, 1=availability, 2=work, 3=driving
        break_sec = sum(
            (end - start).total_seconds()
            for start, end, wt in shift_intervals if wt == 0
        )
        avail_sec = sum(
            (end - start).total_seconds()
            for start, end, wt in shift_intervals if wt == 1
        )
        work_only_sec = sum(
            (end - start).total_seconds()
            for start, end, wt in shift_intervals if wt == 2
        )
        driving_sec = sum(
            (end - start).total_seconds()
            for start, end, wt in shift_intervals if wt == 3
        )
        work_sec = work_only_sec + driving_sec + avail_sec
        work_minutes = int(round(work_sec / 60))
        break_minutes = int(round(break_sec / 60))
        avail_minutes = int(round(avail_sec / 60))
        driving_minutes = int(round(driving_sec / 60))
        work_only_minutes = int(round(work_only_sec / 60))

        # Duration (start to end including breaks)
        duration_minutes = int(round((shift_end - shift_start).total_seconds() / 60))

        # Night hours (40% only if shift started before midnight)
        night_25, night_40 = calculate_shift_night_hours(shift_intervals, shift_start)

        total_work_minutes += work_minutes
        total_driving_minutes += driving_minutes
        total_break_minutes += break_minutes
        total_avail_minutes += avail_minutes
        total_night_25_minutes += night_25
        total_night_40_minutes += night_40

        # Diet based on shift DURATION (not work time)
        if duration_minutes > 8 * 60:
            diet_count += 1

        # Find vehicles used during this shift
        shift_start_date = shift_start.date()
        shift_end_date = shift_end.date()
        day_plates = []
        for v in vehicles:
            v_start = parse_date_safe(v.get('first_use', ''))
            v_end = parse_date_safe(v.get('last_use', ''))
            if v_start and v_end:
                if v_start <= shift_end_date and v_end >= shift_start_date:
                    day_plates.append(v['plate'])
        seen_plates = set()
        unique_plates = []
        for p in day_plates:
            if p not in seen_plates:
                seen_plates.add(p)
                unique_plates.append(p)

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

    total_night_minutes = total_night_25_minutes + total_night_40_minutes

    return {
        'driver_info': driver_info,
        'vehicles': vehicles,
        'summary': {
            'total_work_hm': minutes_to_hm(total_work_minutes),
            'total_work_decimal': minutes_to_decimal(total_work_minutes),
            'total_work_minutes': total_work_minutes,
            'total_driving_hm': minutes_to_hm(total_driving_minutes),
            'total_driving_minutes': total_driving_minutes,
            'total_break_hm': minutes_to_hm(total_break_minutes),
            'total_break_minutes': total_break_minutes,
            'total_avail_hm': minutes_to_hm(total_avail_minutes),
            'total_avail_minutes': total_avail_minutes,
            'night_25_hm': minutes_to_hm(total_night_25_minutes),
            'night_25_decimal': minutes_to_decimal(total_night_25_minutes),
            'night_25_minutes': total_night_25_minutes,
            'night_40_hm': minutes_to_hm(total_night_40_minutes),
            'night_40_decimal': minutes_to_decimal(total_night_40_minutes),
            'night_40_minutes': total_night_40_minutes,
            'total_night_hm': minutes_to_hm(total_night_minutes),
            'total_night_decimal': minutes_to_decimal(total_night_minutes),
            'total_night_minutes': total_night_minutes,
            'diet_count': diet_count,
            'total_shifts': len(shift_details),
        },
        'shift_details': shift_details,
    }


@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'):
        return redirect('/')
    error = None
    if request.method == 'POST':
        if request.form.get('password') == PORTAL_PASSWORD:
            session['logged_in'] = True
            return redirect('/')
        error = 'Nieprawidlowe haslo'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect('/login')


@app.route('/')
@login_required
def index():
    return render_template('portal.html')


@app.route('/reader')
@login_required
def reader():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
@login_required
def upload():
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


@app.route('/dropbox/auth')
@login_required
def dropbox_auth():
    """Start Dropbox OAuth2 flow."""
    flow = dropbox.DropboxOAuth2Flow(
        consumer_key=DROPBOX_APP_KEY,
        consumer_secret=DROPBOX_APP_SECRET,
        redirect_uri=DROPBOX_REDIRECT_URI,
        session=session,
        csrf_token_session_key='dropbox-csrf-token',
        token_access_type='offline',
    )
    authorize_url = flow.start()
    return redirect(authorize_url)


@app.route('/dropbox/callback')
@login_required
def dropbox_callback():
    """Handle Dropbox OAuth2 callback."""
    flow = dropbox.DropboxOAuth2Flow(
        consumer_key=DROPBOX_APP_KEY,
        consumer_secret=DROPBOX_APP_SECRET,
        redirect_uri=DROPBOX_REDIRECT_URI,
        session=session,
        csrf_token_session_key='dropbox-csrf-token',
        token_access_type='offline',
    )
    try:
        result = flow.finish(request.args)
        session['dropbox_token'] = result.access_token
        if result.refresh_token:
            session['dropbox_refresh_token'] = result.refresh_token
        return redirect('/')
    except Exception as e:
        return f"Blad autoryzacji Dropbox: {e}", 400


@app.route('/dropbox/status')
@login_required
def dropbox_status():
    """Check if Dropbox is connected."""
    dbx = get_dropbox_client()
    if dbx:
        try:
            account = dbx.users_get_current_account()
            return jsonify({
                'connected': True,
                'name': account.name.display_name,
                'email': account.email,
            })
        except Exception:
            pass
    return jsonify({'connected': False})


@app.route('/dropbox/disconnect')
@login_required
def dropbox_disconnect():
    """Disconnect Dropbox."""
    session.pop('dropbox_token', None)
    session.pop('dropbox_refresh_token', None)
    return jsonify({'ok': True})


@app.route('/dropbox/browse')
@login_required
def dropbox_browse():
    """Browse Dropbox files and folders."""
    dbx = get_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Nie polaczono z Dropbox'}), 401

    path = request.args.get('path', '')
    try:
        result = dbx.files_list_folder(path)
        items = []
        for entry in result.entries:
            item = {
                'name': entry.name,
                'path': entry.path_display,
            }
            if isinstance(entry, dropbox.files.FolderMetadata):
                item['type'] = 'folder'
            elif isinstance(entry, dropbox.files.FileMetadata):
                item['type'] = 'file'
                item['size'] = entry.size
                item['modified'] = entry.server_modified.isoformat() if entry.server_modified else ''
            items.append(item)
        items.sort(key=lambda x: (0 if x['type'] == 'folder' else 1, x['name'].lower()))
        return jsonify({'items': items, 'path': path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/dropbox/import', methods=['POST'])
@login_required
def dropbox_import():
    """Import a .ddd file from Dropbox and analyze it."""
    dbx = get_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Nie polaczono z Dropbox'}), 401

    file_path = request.json.get('path')
    if not file_path:
        return jsonify({'error': 'Brak sciezki pliku'}), 400

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


@app.route('/dropbox/export', methods=['POST'])
@login_required
def dropbox_export():
    """Export analysis results as CSV to Dropbox."""
    dbx = get_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Nie polaczono z Dropbox'}), 401

    payload = request.json or {}
    driver_name = payload.get('driver_name', 'kierowca')
    shifts = payload.get('shifts', [])
    dest_path = payload.get('path', '/DDD-Wyniki')

    safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip()
    if not safe_name:
        safe_name = 'kierowca'
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{safe_name}_{timestamp}.csv"
    full_path = f"{dest_path}/{filename}"

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow([
        'Start', 'Koniec', 'Czas trwania', 'Pojazd', 'Jazda', 'Praca',
        'Przerwy', 'Czas pracy', 'Nocne 25%', 'Nocne 40%', 'Dieta'
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
    try:
        dbx.files_upload(
            csv_bytes,
            full_path,
            mode=dropbox.files.WriteMode.overwrite,
        )
        return jsonify({'ok': True, 'path': full_path, 'filename': filename})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===== Samsara Integration =====

def samsara_headers():
    return {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}


@app.route('/samsara/status')
@login_required
def samsara_status():
    """Check Samsara connection by listing drivers."""
    if not SAMSARA_API_TOKEN:
        return jsonify({'connected': False})
    try:
        resp = http_requests.get(
            f'{SAMSARA_API_BASE}/fleet/drivers',
            headers=samsara_headers(),
            params={'limit': 1},
            timeout=10,
        )
        if resp.status_code == 200:
            return jsonify({'connected': True})
        return jsonify({'connected': False, 'error': resp.text})
    except Exception as e:
        return jsonify({'connected': False, 'error': str(e)})


@app.route('/samsara/drivers')
@login_required
def samsara_drivers():
    """List drivers with tachograph files available."""
    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Brak tokenu Samsara'}), 401

    # Get last 90 days of tachograph files
    end_time = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    start_time = (datetime.utcnow() - timedelta(days=90)).strftime('%Y-%m-%dT%H:%M:%SZ')

    try:
        all_data = []
        has_next = True
        after = None

        while has_next:
            params = {
                'startTime': start_time,
                'endTime': end_time,
            }
            if after:
                params['after'] = after

            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/drivers/tachograph-files/history',
                headers=samsara_headers(),
                params=params,
                timeout=30,
            )

            if resp.status_code != 200:
                return jsonify({'error': f'Samsara API: {resp.status_code} {resp.text}'}), 500

            body = resp.json()
            all_data.extend(body.get('data', []))

            pagination = body.get('pagination', {})
            after = pagination.get('endCursor')
            has_next = pagination.get('hasNextPage', False)

        # Merge entries by driver ID (API returns separate entries per period)
        driver_map = {}
        for entry in all_data:
            driver = entry.get('driver', {})
            did = driver.get('id', '')
            files = entry.get('tachographFiles', entry.get('files', []))
            if not files:
                continue
            if did not in driver_map:
                driver_map[did] = {
                    'id': did,
                    'name': driver.get('name', 'Nieznany'),
                    'files': [],
                }
            for f in files:
                driver_map[did]['files'].append({
                    'id': f.get('id', ''),
                    'card_number': f.get('cardNumber', ''),
                    'created_at': f.get('createdAtTime', ''),
                    'url': f.get('url', ''),
                })

        # Deduplicate files by ID and sort
        drivers = []
        for d in driver_map.values():
            seen = set()
            unique = []
            for f in d['files']:
                fid = f['id']
                if fid and fid in seen:
                    continue
                seen.add(fid)
                unique.append(f)
            unique.sort(key=lambda f: f.get('created_at', ''), reverse=True)
            drivers.append({
                'id': d['id'],
                'name': d['name'],
                'file_count': len(unique),
                'latest_file': unique[0]['created_at'] if unique else '',
                'files': unique,
            })

        drivers.sort(key=lambda d: d.get('name', ''))
        return jsonify({'drivers': drivers})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/samsara/import', methods=['POST'])
@login_required
def samsara_import():
    """Download a DDD file from Samsara and analyze it."""
    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Brak tokenu Samsara'}), 401

    file_url = (request.json or {}).get('url')
    if not file_url:
        return jsonify({'error': 'Brak URL pliku'}), 400

    try:
        # Download the .ddd file from Samsara S3
        resp = http_requests.get(file_url, timeout=60)
        if resp.status_code != 200:
            return jsonify({'error': f'Blad pobierania pliku: {resp.status_code}'}), 500

        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            tmp.write(resp.content)
            tmp_path = tmp.name

        data = parse_ddd_file(tmp_path)
        result = analyze_card(data)
        result['source'] = 'samsara'
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'tmp_path' in locals():
            os.unlink(tmp_path)


@app.route('/samsara/export-to-dropbox', methods=['POST'])
@login_required
def samsara_export_to_dropbox():
    """Download DDD files from Samsara and upload them to Dropbox."""
    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Brak tokenu Samsara'}), 401

    dbx = get_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Nie polaczono z Dropbox'}), 401

    payload = request.json or {}
    files = payload.get('files', [])
    driver_name = payload.get('driver_name', 'kierowca')
    dest_folder = payload.get('dest_folder', '/Samsara-DDD')

    if not files:
        return jsonify({'error': 'Brak plikow do eksportu'}), 400

    safe_name = "".join(c for c in driver_name if c.isalnum() or c in ' _-').strip() or 'kierowca'
    driver_folder = f"{dest_folder}/{safe_name}"

    results = []
    for f in files:
        url = f.get('url', '')
        card_number = f.get('card_number', '')
        created_at = f.get('created_at', '')
        if not url:
            continue
        try:
            resp = http_requests.get(url, timeout=60)
            if resp.status_code != 200:
                results.append({'ok': False, 'error': f'HTTP {resp.status_code}'})
                continue

            # Build filename: cardnumber_date.ddd
            date_part = created_at[:10] if created_at else datetime.utcnow().strftime('%Y-%m-%d')
            fname = f"{card_number}_{date_part}.ddd" if card_number else f"{safe_name}_{date_part}.ddd"
            dbx_path = f"{driver_folder}/{fname}"

            dbx.files_upload(
                resp.content,
                dbx_path,
                mode=dropbox.files.WriteMode.overwrite,
            )
            results.append({'ok': True, 'path': dbx_path})
        except Exception as e:
            results.append({'ok': False, 'error': str(e)})

    ok_count = sum(1 for r in results if r.get('ok'))
    return jsonify({
        'ok': True,
        'uploaded': ok_count,
        'total': len(files),
        'folder': driver_folder,
        'details': results,
    })


# ===== Portal API =====

PORTAL_CACHE_FILE = os.environ.get('PORTAL_CACHE_FILE', '/opt/ddd-reader/portal_cache.json')
PORTAL_CACHE_MAX_AGE = 300  # 5 minutes


def build_drivers_data(dbx, sync_folder):
    """Build drivers data from Dropbox using a single recursive API call."""
    # One recursive call gets ALL files and folders
    result = dbx.files_list_folder(sync_folder, recursive=True)
    all_entries = list(result.entries)
    while result.has_more:
        result = dbx.files_list_folder_continue(result.cursor)
        all_entries.extend(result.entries)

    # Group files by parent folder (driver)
    driver_files = {}
    driver_paths = {}
    for entry in all_entries:
        if isinstance(entry, dropbox.files.FolderMetadata):
            # Top-level folders are drivers
            rel = entry.path_display[len(sync_folder):].strip('/')
            if '/' not in rel and rel:
                driver_paths[rel] = entry.path_display
            continue
        if not isinstance(entry, dropbox.files.FileMetadata):
            continue
        # Extract driver name from path: /Samsara-DDD/DriverName/file.ddd
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

    # Build driver summaries
    drivers = []
    all_driver_names = set(driver_paths.keys()) | set(driver_files.keys())
    for driver_name in all_driver_names:
        files = driver_files.get(driver_name, [])
        files.sort(key=lambda x: x.get('file_date', ''), reverse=True)

        earliest_date = ''
        latest_date = ''
        latest_download = ''
        card_number = ''
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
    """Load cached portal data if fresh enough."""
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
    """Save portal data to cache file."""
    try:
        with open(PORTAL_CACHE_FILE, 'w') as f:
            json.dump(drivers, f)
    except Exception:
        pass


@app.route('/portal/drivers')
@login_required
def portal_drivers():
    """List all drivers from Dropbox /Samsara-DDD/ folder with file metadata."""
    force = request.args.get('refresh') == '1'

    if not force:
        cached = load_portal_cache()
        if cached is not None:
            # Recalculate days_since from cached data
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
        return jsonify({'error': 'Brak polaczenia z Dropbox (brak DROPBOX_REFRESH_TOKEN)'}), 500

    sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')

    try:
        drivers = build_drivers_data(dbx, sync_folder)
        save_portal_cache(drivers)
        return jsonify({'drivers': drivers})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/portal/download')
@login_required
def portal_download():
    """Download a DDD file from Dropbox and analyze it."""
    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    file_path = request.args.get('path')
    if not file_path:
        return jsonify({'error': 'Brak sciezki pliku'}), 400

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


@app.route('/portal/sync-status')
@login_required
def portal_sync_status():
    """Get sync status from state file."""
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


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=40110)
