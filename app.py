import csv
import io
import json
import math
import os
import secrets
import sqlite3
import subprocess
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import dropbox
from dropbox.exceptions import AuthError
from flask import Flask, render_template, request, jsonify, redirect, session, url_for
from zoneinfo import ZoneInfo


def _load_dotenv():
    """Load KEY=VALUE pairs from a .env file (if present) into the environment
    without overriding variables already set (systemd/real env wins). Avoids a
    hard dependency on python-dotenv so a token placed in .env is always read."""
    for path in (
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'),
        os.path.join(os.getcwd(), '.env'),
    ):
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith('#') or '=' not in line:
                        continue
                    key, _, val = line.partition('=')
                    key = key.strip()
                    if key.lower().startswith('export '):
                        key = key[7:].strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except (FileNotFoundError, OSError):
            continue


_load_dotenv()

UTC = ZoneInfo('UTC')
CET = ZoneInfo('Europe/Berlin')

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'ddd-parser-secret-key-change-me')

DDDPARSER_PATH = os.environ.get('DDDPARSER_PATH', 'dddparser')

# Dropbox OAuth2 config
DROPBOX_APP_KEY = os.environ.get('DROPBOX_APP_KEY', 'j9ntkihedd9495i')
DROPBOX_APP_SECRET = os.environ.get('DROPBOX_APP_SECRET', 'd3hr43reha9kky8')
DROPBOX_REDIRECT_URI = os.environ.get('DROPBOX_REDIRECT_URI', 'http://dddd.bieda.it/dropbox/callback')

# Fuel cards (karty paliwowe) storage
FUEL_CARDS_DB = os.environ.get(
    'FUEL_CARDS_DB',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fuel_cards.db'),
)

# Common fuel-card suppliers, used as autocomplete hints in the UI
COMMON_FUEL_SUPPLIERS = [
    'DKV', 'UTA', 'Aral', 'Shell', 'BP', 'Orlen', 'E100', 'Eurowag',
    'Circle K', 'Lotos', 'Total', 'Esso', 'AS 24', 'Routex', 'Moya', 'IDS',
]


def get_fuel_db():
    """Open a SQLite connection to the fuel-cards database."""
    conn = sqlite3.connect(FUEL_CARDS_DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_fuel_db():
    """Create the fuel_cards table if it does not exist."""
    conn = get_fuel_db()
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS fuel_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier TEXT NOT NULL,
            card_name TEXT NOT NULL,
            card_number TEXT,
            driver TEXT,
            notes TEXT,
            created_at TEXT NOT NULL
        )
        '''
    )
    conn.commit()
    conn.close()


def fuel_card_to_dict(row):
    """Serialize a fuel_cards row into a plain dict."""
    return {
        'id': row['id'],
        'supplier': row['supplier'],
        'card_name': row['card_name'],
        'card_number': row['card_number'] or '',
        'driver': row['driver'] or '',
        'notes': row['notes'] or '',
        'created_at': row['created_at'],
    }


init_fuel_db()


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
      - 00:00-04:00 => 40% if shift started before midnight, else 25%
      - 04:00-06:00 => always 25%
      - A given minute is either 25% or 40%, never both

    Returns (night_25_minutes, night_40_minutes).
    """
    # Determine if shift started before midnight (evening shift)
    shift_started_before_midnight = shift_start.hour >= 12

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

            # 00:00-04:00 => 40% if shift started before midnight, else 25%
            nr_start = day_base
            nr_end = day_base + timedelta(hours=4)
            o_start = max(current, nr_start)
            o_end = min(chunk_end, nr_end)
            if o_end > o_start:
                secs = (o_end - o_start).total_seconds()
                if shift_started_before_midnight:
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


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
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
def dropbox_disconnect():
    """Disconnect Dropbox."""
    session.pop('dropbox_token', None)
    session.pop('dropbox_refresh_token', None)
    return jsonify({'ok': True})


@app.route('/dropbox/browse')
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


# =============================================================================
# Karty paliwowe (fuel cards)
# =============================================================================

@app.route('/fuel-cards')
def fuel_cards_page():
    """Render the fuel-cards management page."""
    return render_template('fuel_cards.html', suppliers=COMMON_FUEL_SUPPLIERS)


@app.route('/api/fuel-cards', methods=['GET'])
def api_fuel_cards_list():
    """Return all fuel cards, sorted by supplier and card name."""
    conn = get_fuel_db()
    rows = conn.execute(
        'SELECT * FROM fuel_cards ORDER BY supplier COLLATE NOCASE, card_name COLLATE NOCASE'
    ).fetchall()
    conn.close()
    return jsonify({'cards': [fuel_card_to_dict(r) for r in rows]})


@app.route('/api/fuel-cards', methods=['POST'])
def api_fuel_cards_add():
    """Add a single fuel card. Driver may be empty (no assignment)."""
    data = request.get_json(silent=True) or {}
    supplier = (data.get('supplier') or '').strip()
    card_name = (data.get('card_name') or '').strip()
    if not supplier:
        return jsonify({'error': 'Dostawca jest wymagany'}), 400
    if not card_name:
        return jsonify({'error': 'Nazwa karty jest wymagana'}), 400
    card_number = (data.get('card_number') or '').strip()
    driver = (data.get('driver') or '').strip()
    notes = (data.get('notes') or '').strip()
    conn = get_fuel_db()
    cur = conn.execute(
        'INSERT INTO fuel_cards (supplier, card_name, card_number, driver, notes, created_at)'
        ' VALUES (?, ?, ?, ?, ?, ?)',
        (supplier, card_name, card_number, driver, notes,
         datetime.now().isoformat(timespec='seconds')),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({'ok': True, 'id': new_id})


@app.route('/api/fuel-cards/bulk', methods=['POST'])
def api_fuel_cards_bulk():
    """Bulk-add fuel cards for one supplier.

    Accepts a supplier, an optional driver applied to every card (empty means
    no assignment), and a `text` blob with one card name per line and/or a
    `cards` list (plain names or per-card objects).
    """
    data = request.get_json(silent=True) or {}
    supplier = (data.get('supplier') or '').strip()
    if not supplier:
        return jsonify({'error': 'Dostawca jest wymagany'}), 400
    default_driver = (data.get('driver') or '').strip()

    entries = []
    text = data.get('text')
    if isinstance(text, str):
        for line in text.splitlines():
            name = line.strip()
            if name:
                entries.append({'card_name': name, 'card_number': '', 'driver': default_driver})
    for item in (data.get('cards') or []):
        if isinstance(item, str):
            name = item.strip()
            if name:
                entries.append({'card_name': name, 'card_number': '', 'driver': default_driver})
        elif isinstance(item, dict):
            name = (item.get('card_name') or '').strip()
            if not name:
                continue
            drv = item.get('driver')
            entries.append({
                'card_name': name,
                'card_number': (item.get('card_number') or '').strip(),
                'driver': drv.strip() if isinstance(drv, str) else default_driver,
            })

    if not entries:
        return jsonify({'error': 'Brak kart do dodania'}), 400

    now = datetime.now().isoformat(timespec='seconds')
    conn = get_fuel_db()
    conn.executemany(
        'INSERT INTO fuel_cards (supplier, card_name, card_number, driver, notes, created_at)'
        ' VALUES (?, ?, ?, ?, ?, ?)',
        [(supplier, e['card_name'], e['card_number'], e['driver'], '', now) for e in entries],
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'count': len(entries)})


@app.route('/api/fuel-cards/<int:card_id>', methods=['PATCH', 'PUT'])
def api_fuel_cards_update(card_id):
    """Update a fuel card. An empty driver clears the assignment."""
    data = request.get_json(silent=True) or {}
    conn = get_fuel_db()
    row = conn.execute('SELECT * FROM fuel_cards WHERE id = ?', (card_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Nie znaleziono karty'}), 404

    supplier = (data.get('supplier', row['supplier']) or '').strip() or row['supplier']
    card_name = (data.get('card_name', row['card_name']) or '').strip() or row['card_name']
    card_number = (data.get('card_number', row['card_number']) or '').strip()
    driver = (data.get('driver', row['driver']) or '').strip()
    notes = (data.get('notes', row['notes']) or '').strip()

    conn.execute(
        'UPDATE fuel_cards SET supplier=?, card_name=?, card_number=?, driver=?, notes=? WHERE id=?',
        (supplier, card_name, card_number, driver, notes, card_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/fuel-cards/<int:card_id>', methods=['DELETE'])
def api_fuel_cards_delete(card_id):
    """Delete a fuel card."""
    conn = get_fuel_db()
    conn.execute('DELETE FROM fuel_cards WHERE id = ?', (card_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# =============================================================================
# Sledzenie tras pojazdow (vehicle route tracking) + publiczne linki
# =============================================================================

TRACKING_DB = os.environ.get(
    'TRACKING_DB',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tracking.db'),
)
# Default days of history shown on a public link (each share can override)
TRACK_HISTORY_DAYS = int(os.environ.get('TRACK_HISTORY_DAYS', '7'))
# Shared secret for the external push endpoint /api/track/ingest. When empty,
# that endpoint is disabled and positions come from the GPS provider pull
# adapter or the admin UI instead.
TRACKING_INGEST_TOKEN = os.environ.get('TRACKING_INGEST_TOKEN', '')

# Reverse geocoding via OpenStreetMap Nominatim
NOMINATIM_URL = os.environ.get('NOMINATIM_URL', 'https://nominatim.openstreetmap.org/reverse')
GEOCODE_USER_AGENT = os.environ.get('GEOCODE_USER_AGENT', 'LTS-Fleet-Tracker/1.0')

# GPS telematics provider (pull) integration. Credentials via env. When the
# provider is 'none', positions are expected from /api/track/ingest (provider
# webhook / cron bridge) or the admin UI instead of being pulled.
GPS_API_URL = os.environ.get('GPS_API_URL', '')
GPS_API_TOKEN = os.environ.get('GPS_API_TOKEN', '')
GPS_API_USER = os.environ.get('GPS_API_USER', '')
GPS_API_PASSWORD = os.environ.get('GPS_API_PASSWORD', '')

# Samsara (https://developers.samsara.com). The token is read from the first
# of these env vars that is set, so whatever name is already in your .env works.
SAMSARA_TOKEN_ENV_NAMES = (
    'SAMSARA_API_TOKEN', 'SAMSARA_TOKEN', 'SAMSARA_API_KEY', 'SAMSARA_KEY',
    'VITE_SAMSARA_API_TOKEN', 'VITE_SAMSARA_TOKEN', 'GPS_API_TOKEN',
)


def _resolve_samsara_token():
    for name in SAMSARA_TOKEN_ENV_NAMES:
        val = (os.environ.get(name) or '').strip()
        if val:
            return val, name
    return '', None


SAMSARA_API_TOKEN, SAMSARA_TOKEN_SOURCE = _resolve_samsara_token()

# Region base URL. If not set explicitly, auto-detect EU vs US on first call
# (EU tried first — most European Samsara accounts live on api.eu.samsara.com).
_samsara_url_explicit = (os.environ.get('SAMSARA_API_URL') or GPS_API_URL or '').strip()
SAMSARA_BASE_CANDIDATES = ([_samsara_url_explicit] if _samsara_url_explicit
                           else ['https://api.eu.samsara.com', 'https://api.samsara.com'])
_samsara_base = {'url': _samsara_url_explicit or None}

# Provider auto-selects to 'samsara' when a token is present, unless
# GPS_PROVIDER is set explicitly (e.g. 'none' to disable pulling).
GPS_PROVIDER = (os.environ.get('GPS_PROVIDER', '').strip().lower()
                or ('samsara' if SAMSARA_API_TOKEN else 'none'))
# Min seconds between automatic provider polls per share (throttle)
GPS_POLL_THROTTLE = int(os.environ.get('GPS_POLL_THROTTLE', '20'))


def get_tracking_db():
    """Open a SQLite connection to the tracking database."""
    conn = sqlite3.connect(TRACKING_DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_tracking_db():
    """Create the tracking tables if they do not exist."""
    conn = get_tracking_db()
    conn.executescript(
        '''
        CREATE TABLE IF NOT EXISTS track_shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL UNIQUE,
            label TEXT,
            driver_name TEXT,
            vehicle_id TEXT NOT NULL,
            vehicle_name TEXT,
            history_days INTEGER NOT NULL DEFAULT 7,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            expires_at TEXT,
            last_polled_at TEXT
        );
        CREATE TABLE IF NOT EXISTS positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            recorded_at TEXT NOT NULL,
            speed REAL,
            heading REAL,
            address TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_positions_vehicle_time
            ON positions (vehicle_id, recorded_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_unique
            ON positions (vehicle_id, recorded_at);
        CREATE TABLE IF NOT EXISTS geocode_cache (
            coord_key TEXT PRIMARY KEY,
            address TEXT,
            created_at TEXT NOT NULL
        );
        '''
    )
    # Migration: add vehicle_name (display) to pre-existing databases
    cols = [r[1] for r in conn.execute('PRAGMA table_info(track_shares)').fetchall()]
    if 'vehicle_name' not in cols:
        conn.execute('ALTER TABLE track_shares ADD COLUMN vehicle_name TEXT')
    conn.commit()
    conn.close()


init_tracking_db()


def _now_iso():
    return datetime.now().isoformat(timespec='seconds')


def normalize_ts(value):
    """Normalize a timestamp (ISO string, epoch, common formats) to ISO 8601."""
    if value is None or value == '':
        return _now_iso()
    if isinstance(value, (int, float)):
        v = float(value)
        if v > 1e12:  # milliseconds
            v /= 1000.0
        try:
            return datetime.fromtimestamp(v).isoformat(timespec='seconds')
        except (OverflowError, OSError, ValueError):
            return _now_iso()
    s = str(value).strip()
    try:
        dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt.isoformat(timespec='seconds')
    except ValueError:
        pass
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%d.%m.%Y %H:%M:%S',
                '%Y-%m-%d %H:%M', '%d.%m.%Y %H:%M'):
        try:
            return datetime.strptime(s, fmt).isoformat(timespec='seconds')
        except ValueError:
            continue
    return _now_iso()


def haversine_m(lat1, lon1, lat2, lon2):
    """Distance in meters between two lat/lon points."""
    r = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def _coord_key(lat, lon):
    return f"{round(float(lat), 4)},{round(float(lon), 4)}"


def reverse_geocode(lat, lon):
    """Reverse-geocode a coordinate to an address, cached in SQLite."""
    try:
        key = _coord_key(lat, lon)
    except (TypeError, ValueError):
        return ''
    conn = get_tracking_db()
    row = conn.execute('SELECT address FROM geocode_cache WHERE coord_key = ?', (key,)).fetchone()
    conn.close()
    if row:
        return row['address'] or ''

    address = ''
    try:
        params = urllib.parse.urlencode({
            'lat': lat, 'lon': lon, 'format': 'jsonv2', 'zoom': 18, 'addressdetails': 0,
        })
        req = urllib.request.Request(
            f"{NOMINATIM_URL}?{params}",
            headers={'User-Agent': GEOCODE_USER_AGENT, 'Accept-Language': 'pl,de,en'},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
            address = (payload.get('display_name') or '').strip()
    except Exception:
        address = ''

    if address:
        conn = get_tracking_db()
        conn.execute(
            'INSERT OR REPLACE INTO geocode_cache (coord_key, address, created_at) VALUES (?, ?, ?)',
            (key, address, _now_iso()),
        )
        conn.commit()
        conn.close()
    return address


def store_positions(vehicle_id, points):
    """Insert position dicts, ignoring duplicate (vehicle_id, recorded_at).

    Returns the number of rows actually inserted.
    """
    rows = []
    now = _now_iso()
    for p in (points or []):
        try:
            lat = float(p['lat'])
            lon = float(p['lon'])
        except (KeyError, TypeError, ValueError):
            continue
        recorded_at = normalize_ts(p.get('recorded_at'))
        speed, heading = p.get('speed'), p.get('heading')
        try:
            speed = float(speed) if speed not in (None, '') else None
        except (TypeError, ValueError):
            speed = None
        try:
            heading = float(heading) if heading not in (None, '') else None
        except (TypeError, ValueError):
            heading = None
        addr = p.get('address')
        addr = addr.strip() if isinstance(addr, str) and addr.strip() else None
        rows.append((vehicle_id, lat, lon, recorded_at, speed, heading, addr, now))
    if not rows:
        return 0
    conn = get_tracking_db()
    before = conn.total_changes
    conn.executemany(
        'INSERT OR IGNORE INTO positions'
        ' (vehicle_id, lat, lon, recorded_at, speed, heading, address, created_at)'
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        rows,
    )
    conn.commit()
    inserted = conn.total_changes - before
    conn.close()
    return inserted


def _to_rfc3339(iso_local):
    """Convert a naive local ISO timestamp to RFC 3339 (with offset) for Samsara."""
    try:
        dt = datetime.fromisoformat(str(iso_local))
    except (ValueError, TypeError):
        dt = datetime.now()
    if dt.tzinfo is None:
        dt = dt.astimezone()  # attach the server's local timezone
    return dt.isoformat()


def _samsara_request(base, path, params):
    """Perform one Samsara GET against a specific base URL."""
    url = base.rstrip('/') + path
    if params:
        url += '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {SAMSARA_API_TOKEN}',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))


def samsara_base_url():
    """The Samsara base URL in use (pinned after the first successful call)."""
    return _samsara_base['url'] or SAMSARA_BASE_CANDIDATES[0]


def _samsara_get(path, params):
    """GET a Samsara endpoint, auto-detecting the EU/US region on first use."""
    if _samsara_base['url']:
        return _samsara_request(_samsara_base['url'], path, params)
    last_exc = None
    for base in SAMSARA_BASE_CANDIDATES:
        try:
            data = _samsara_request(base, path, params)
            _samsara_base['url'] = base   # pin the working region for later calls
            return data
        except Exception as exc:
            last_exc = exc
    raise last_exc if last_exc else RuntimeError('Samsara base URL unresolved')


_samsara_vehicle_cache = {'ts': None, 'by_key': {}}


def _samsara_resolve_vehicle(vehicle_id):
    """Resolve our vehicle_id (Samsara id, name, license plate or VIN) to a Samsara id."""
    vid = str(vehicle_id).strip()
    cache = _samsara_vehicle_cache
    fresh = cache['ts'] and (datetime.now() - cache['ts']).total_seconds() < 600
    if not fresh:
        by_key = {}
        params = {'limit': 512}
        cursor = None
        try:
            for _ in range(10):
                if cursor:
                    params['after'] = cursor
                data = _samsara_get('/fleet/vehicles', params)
                for v in data.get('data', []):
                    sid = str(v.get('id', '')).strip()
                    if not sid:
                        continue
                    by_key[sid.lower()] = sid
                    for field in ('name', 'licensePlate', 'vin'):
                        val = (v.get(field) or '').strip().lower()
                        if val:
                            by_key[val] = sid
                page = data.get('pagination', {})
                if page.get('hasNextPage') and page.get('endCursor'):
                    cursor = page['endCursor']
                else:
                    break
            cache['by_key'] = by_key
            cache['ts'] = datetime.now()
        except Exception as exc:  # keep any previous cache on failure
            app.logger.warning('Samsara vehicle list failed: %s', exc)
    return cache['by_key'].get(vid.lower(), vid)


def _fetch_positions_samsara(vehicle_id, since_iso):
    """Pull GPS history for one vehicle from Samsara's stats/history endpoint."""
    if not SAMSARA_API_TOKEN:
        return []
    sid = _samsara_resolve_vehicle(vehicle_id)
    params = {
        'types': 'gps',
        'vehicleIds': sid,
        'startTime': _to_rfc3339(since_iso),
        'endTime': _to_rfc3339(_now_iso()),
    }
    points = []
    cursor = None
    try:
        for _ in range(20):  # cap pages per poll
            if cursor:
                params['after'] = cursor
            data = _samsara_get('/fleet/vehicles/stats/history', params)
            for veh in data.get('data', []):
                for g in (veh.get('gps') or []):
                    lat, lon = g.get('latitude'), g.get('longitude')
                    if lat is None or lon is None:
                        continue
                    mph = g.get('speedMilesPerHour')
                    speed = round(mph * 1.60934, 1) if isinstance(mph, (int, float)) else None
                    address = ((g.get('reverseGeo') or {}).get('formattedLocation') or '').strip()
                    points.append({
                        'lat': lat,
                        'lon': lon,
                        'recorded_at': g.get('time'),
                        'speed': speed,
                        'heading': g.get('headingDegrees'),
                        'address': address or None,
                    })
            page = data.get('pagination', {})
            if page.get('hasNextPage') and page.get('endCursor'):
                cursor = page['endCursor']
            else:
                break
    except Exception as exc:
        app.logger.warning('Samsara GPS history failed for %s: %s', vehicle_id, exc)
    return points


def fetch_positions(vehicle_id, since_iso):
    """Pull recent positions for a vehicle from the configured GPS provider.

    Returns a list of dicts {lat, lon, recorded_at, speed, heading, address};
    only fixes newer than since_iso need to be returned.

    With GPS_PROVIDER == 'none' this returns nothing and positions are taken
    from /api/track/ingest (provider webhook / cron bridge) or the admin UI.
    """
    provider = (GPS_PROVIDER or 'none').lower()
    if provider == 'samsara':
        return _fetch_positions_samsara(vehicle_id, since_iso)
    return []


def maybe_poll_provider(share):
    """If a GPS provider is configured, pull new positions for a share (throttled)."""
    if (GPS_PROVIDER or 'none').lower() == 'none':
        return
    last = share['last_polled_at']
    if last:
        try:
            if (datetime.now() - datetime.fromisoformat(last)).total_seconds() < GPS_POLL_THROTTLE:
                return
        except ValueError:
            pass
    # Incremental: pull from the last stored fix; on first poll backfill the
    # whole history window so the link shows history immediately.
    window_start = (datetime.now() - timedelta(days=share['history_days'])).isoformat(timespec='seconds')
    conn = get_tracking_db()
    row = conn.execute(
        'SELECT MAX(recorded_at) AS m FROM positions WHERE vehicle_id = ?',
        (share['vehicle_id'],),
    ).fetchone()
    conn.close()
    since = row['m'] if row and row['m'] and row['m'] > window_start else window_start
    try:
        store_positions(share['vehicle_id'], fetch_positions(share['vehicle_id'], since))
    except Exception:
        pass
    conn = get_tracking_db()
    conn.execute('UPDATE track_shares SET last_polled_at = ? WHERE id = ?', (_now_iso(), share['id']))
    conn.commit()
    conn.close()


def get_share_by_token(token):
    conn = get_tracking_db()
    row = conn.execute('SELECT * FROM track_shares WHERE token = ?', (token,)).fetchone()
    conn.close()
    return row


def share_is_expired(row):
    exp = row['expires_at']
    if not exp:
        return False
    return datetime.now().date().isoformat() > str(exp)[:10]


def share_is_live(row):
    return bool(row) and row['active'] == 1 and not share_is_expired(row)


def share_status(row):
    if row['active'] != 1:
        return 'wylaczony'
    if share_is_expired(row):
        return 'wygasl'
    return 'aktywny'


def share_to_dict(row, point_count=None, last_point=None):
    keys = row.keys()
    return {
        'id': row['id'],
        'token': row['token'],
        'label': row['label'] or '',
        'driver_name': row['driver_name'] or '',
        'vehicle_id': row['vehicle_id'],
        'vehicle_name': (row['vehicle_name'] if 'vehicle_name' in keys else '') or '',
        'history_days': row['history_days'],
        'active': row['active'] == 1,
        'status': share_status(row),
        'created_at': row['created_at'],
        'expires_at': row['expires_at'] or '',
        'point_count': point_count,
        'last_point': last_point,
    }


def compute_key_points(points, min_gap_min=15, min_dist_m=1500, max_points=80):
    """Reduce a dense track to meaningful key points (start, stops, current)."""
    if not points:
        return []
    if len(points) == 1:
        return [points[0]]
    key = [points[0]]
    for p in points[1:-1]:
        last = key[-1]
        try:
            gap_min = (datetime.fromisoformat(p['recorded_at'])
                       - datetime.fromisoformat(last['recorded_at'])).total_seconds() / 60.0
        except (ValueError, TypeError):
            gap_min = min_gap_min + 1
        dist = haversine_m(last['lat'], last['lon'], p['lat'], p['lon'])
        if gap_min >= min_gap_min or dist >= min_dist_m:
            key.append(p)
    key.append(points[-1])
    if len(key) > max_points:
        step = len(key) / float(max_points)
        sampled = [key[int(i * step)] for i in range(max_points)]
        sampled[0], sampled[-1] = key[0], key[-1]
        key = sampled
    return key


# ----- Admin: zarzadzanie publicznymi linkami -----

@app.route('/tracking')
def tracking_admin_page():
    """Render the tracking-share management page."""
    return render_template(
        'tracking_admin.html',
        gps_provider=GPS_PROVIDER,
        ingest_enabled=bool(TRACKING_INGEST_TOKEN),
    )


@app.route('/api/track/samsara/check')
def api_samsara_check():
    """Quick connectivity probe so the admin can verify the Samsara token/region."""
    if not SAMSARA_API_TOKEN:
        return jsonify({'ok': False, 'token_present': False,
                        'error': 'Brak tokenu Samsara w srodowisku/.env (np. SAMSARA_API_TOKEN)'})
    try:
        data = _samsara_get('/fleet/vehicles', {'limit': 1})
        return jsonify({'ok': True, 'token_present': True, 'token_source': SAMSARA_TOKEN_SOURCE,
                        'base_url': samsara_base_url(), 'sample': len(data.get('data', []))})
    except Exception as exc:
        return jsonify({'ok': False, 'token_present': True, 'token_source': SAMSARA_TOKEN_SOURCE,
                        'base_url': samsara_base_url(), 'error': str(exc)})


@app.route('/api/track/vehicles')
def api_track_vehicles():
    """List vehicles from Samsara so the admin can pick one when creating a link."""
    if (GPS_PROVIDER or 'none').lower() != 'samsara':
        return jsonify({'vehicles': [], 'provider': GPS_PROVIDER})
    vehicles = []
    try:
        params = {'limit': 512}
        cursor = None
        for _ in range(10):
            if cursor:
                params['after'] = cursor
            data = _samsara_get('/fleet/vehicles', params)
            for v in data.get('data', []):
                vehicles.append({
                    'id': str(v.get('id', '')),
                    'name': v.get('name') or '',
                    'license_plate': v.get('licensePlate') or '',
                })
            page = data.get('pagination', {})
            if page.get('hasNextPage') and page.get('endCursor'):
                cursor = page['endCursor']
            else:
                break
    except Exception as exc:
        app.logger.warning('Samsara vehicles list failed: %s', exc)
        return jsonify({'vehicles': [], 'error': str(exc)})
    vehicles.sort(key=lambda x: (x['name'] or x['license_plate'] or x['id']).lower())
    return jsonify({'vehicles': vehicles, 'count': len(vehicles)})


@app.route('/api/track/shares', methods=['GET'])
def api_track_shares_list():
    conn = get_tracking_db()
    shares = conn.execute('SELECT * FROM track_shares ORDER BY created_at DESC').fetchall()
    out = []
    for s in shares:
        agg = conn.execute(
            'SELECT COUNT(*) AS c, MAX(recorded_at) AS m FROM positions WHERE vehicle_id = ?',
            (s['vehicle_id'],),
        ).fetchone()
        out.append(share_to_dict(s, agg['c'], agg['m']))
    conn.close()
    return jsonify({'shares': out})


@app.route('/api/track/shares', methods=['POST'])
def api_track_shares_create():
    data = request.get_json(silent=True) or {}
    vehicle_id = (data.get('vehicle_id') or '').strip()
    if not vehicle_id:
        return jsonify({'error': 'Identyfikator pojazdu (nr rej. / ID) jest wymagany'}), 400
    label = (data.get('label') or '').strip()
    driver_name = (data.get('driver_name') or '').strip()
    vehicle_name = (data.get('vehicle_name') or '').strip()
    try:
        history_days = int(data.get('history_days') or TRACK_HISTORY_DAYS)
    except (TypeError, ValueError):
        history_days = TRACK_HISTORY_DAYS
    history_days = max(1, min(history_days, 90))
    expires_at = (data.get('expires_at') or '').strip() or None
    token = secrets.token_urlsafe(24)
    conn = get_tracking_db()
    conn.execute(
        'INSERT INTO track_shares'
        ' (token, label, driver_name, vehicle_id, vehicle_name, history_days, active, created_at, expires_at)'
        ' VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
        (token, label, driver_name, vehicle_id, vehicle_name, history_days, _now_iso(), expires_at),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'token': token})


@app.route('/api/track/shares/<int:share_id>', methods=['PATCH'])
def api_track_shares_update(share_id):
    data = request.get_json(silent=True) or {}
    conn = get_tracking_db()
    row = conn.execute('SELECT * FROM track_shares WHERE id = ?', (share_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Nie znaleziono linku'}), 404
    label = (data.get('label', row['label']) or '').strip()
    driver_name = (data.get('driver_name', row['driver_name']) or '').strip()
    vehicle_id = (data.get('vehicle_id', row['vehicle_id']) or '').strip() or row['vehicle_id']
    active = (1 if data.get('active') else 0) if 'active' in data else row['active']
    try:
        history_days = int(data.get('history_days', row['history_days']))
    except (TypeError, ValueError):
        history_days = row['history_days']
    history_days = max(1, min(history_days, 90))
    if 'expires_at' in data:
        expires_at = (data.get('expires_at') or '').strip() or None
    else:
        expires_at = row['expires_at']
    conn.execute(
        'UPDATE track_shares SET label=?, driver_name=?, vehicle_id=?, active=?,'
        ' history_days=?, expires_at=? WHERE id=?',
        (label, driver_name, vehicle_id, active, history_days, expires_at, share_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/track/shares/<int:share_id>', methods=['DELETE'])
def api_track_shares_delete(share_id):
    conn = get_tracking_db()
    conn.execute('DELETE FROM track_shares WHERE id = ?', (share_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/track/shares/<int:share_id>/positions', methods=['POST'])
def api_track_add_positions(share_id):
    """Manually add positions for a share's vehicle (admin / push bridge)."""
    conn = get_tracking_db()
    row = conn.execute('SELECT * FROM track_shares WHERE id = ?', (share_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Nie znaleziono linku'}), 404
    data = request.get_json(silent=True) or {}
    points = data.get('positions')
    if points is None and data.get('lat') is not None:
        points = [{k: data.get(k) for k in ('lat', 'lon', 'recorded_at', 'speed', 'heading')}]
    inserted = store_positions(row['vehicle_id'], points or [])
    return jsonify({'ok': True, 'inserted': inserted})


@app.route('/api/track/shares/<int:share_id>/simulate', methods=['POST'])
def api_track_simulate(share_id):
    """Seed a short demo route so the public link can be previewed before GPS is wired."""
    conn = get_tracking_db()
    row = conn.execute('SELECT * FROM track_shares WHERE id = ?', (share_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Nie znaleziono linku'}), 404
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data.get('lat', 52.2297))   # default: Warszawa
        lon = float(data.get('lon', 21.0122))
    except (TypeError, ValueError):
        lat, lon = 52.2297, 21.0122
    n = 12
    start = datetime.now() - timedelta(minutes=15 * n)
    pts = [{
        'lat': lat + i * 0.004,
        'lon': lon + i * 0.006,
        'recorded_at': (start + timedelta(minutes=15 * i)).isoformat(timespec='seconds'),
        'speed': 0 if i in (0, n - 1) else 50,
    } for i in range(n)]
    inserted = store_positions(row['vehicle_id'], pts)
    return jsonify({'ok': True, 'inserted': inserted})


@app.route('/api/track/ingest', methods=['POST'])
def api_track_ingest():
    """External push endpoint for GPS positions (provider webhook / cron bridge).

    Disabled unless TRACKING_INGEST_TOKEN is set; callers must then pass it as
    a Bearer token or ?token=.
    """
    if not TRACKING_INGEST_TOKEN:
        return jsonify({'error': 'Endpoint wylaczony — ustaw TRACKING_INGEST_TOKEN'}), 503
    auth = request.headers.get('Authorization', '')
    supplied = auth[7:].strip() if auth.startswith('Bearer ') else request.args.get('token', '')
    if supplied != TRACKING_INGEST_TOKEN:
        return jsonify({'error': 'Brak autoryzacji'}), 401
    data = request.get_json(silent=True) or {}
    vehicle_id = (data.get('vehicle_id') or '').strip()
    if not vehicle_id:
        return jsonify({'error': 'vehicle_id wymagany'}), 400
    points = data.get('positions')
    if points is None and data.get('lat') is not None:
        points = [{k: data.get(k) for k in ('lat', 'lon', 'recorded_at', 'speed', 'heading')}]
    inserted = store_positions(vehicle_id, points or [])
    return jsonify({'ok': True, 'inserted': inserted})


# ----- Public: read-only, tokenized tracking link -----

@app.route('/t/<token>')
def public_track_page(token):
    share = get_share_by_token(token)
    if not share_is_live(share):
        return render_template('track_unavailable.html'), 404
    label = share['label'] or share['driver_name'] or 'Pojazd'
    return render_template('track.html', token=token, label=label,
                           driver=share['driver_name'] or '')


@app.route('/api/track/<token>')
def api_public_track(token):
    share = get_share_by_token(token)
    if not share_is_live(share):
        return jsonify({'error': 'Link nieaktywny lub wygasl'}), 404
    maybe_poll_provider(share)
    since = (datetime.now() - timedelta(days=share['history_days'])).isoformat(timespec='seconds')
    conn = get_tracking_db()
    rows = conn.execute(
        'SELECT lat, lon, recorded_at, speed, heading, address FROM positions'
        ' WHERE vehicle_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC',
        (share['vehicle_id'], since),
    ).fetchall()
    conn.close()
    points = [dict(r) for r in rows]
    path = [[p['lat'], p['lon']] for p in points]
    if len(path) > 2000:  # cap polyline size for the browser
        step = len(path) / 2000.0
        path = [path[int(i * step)] for i in range(2000)]
    return jsonify({
        'label': share['label'] or share['driver_name'] or 'Pojazd',
        'driver_name': share['driver_name'] or '',
        'count': len(points),
        'path': path,
        'key_points': compute_key_points(points),
        'current': points[-1] if points else None,
        'updated_at': _now_iso(),
    })


@app.route('/api/track/<token>/geocode', methods=['POST'])
def api_public_geocode(token):
    share = get_share_by_token(token)
    if not share_is_live(share):
        return jsonify({'error': 'Link nieaktywny lub wygasl'}), 404
    data = request.get_json(silent=True) or {}
    lat, lon = data.get('lat'), data.get('lon')
    if lat is None or lon is None:
        return jsonify({'error': 'lat/lon wymagane'}), 400
    address = reverse_geocode(lat, lon)
    if address:
        try:
            conn = get_tracking_db()
            conn.execute(
                'UPDATE positions SET address = ? WHERE vehicle_id = ? AND address IS NULL'
                ' AND round(lat, 4) = ? AND round(lon, 4) = ?',
                (address, share['vehicle_id'], round(float(lat), 4), round(float(lon), 4)),
            )
            conn.commit()
            conn.close()
        except (TypeError, ValueError):
            pass
    return jsonify({'address': address})


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=40110)
