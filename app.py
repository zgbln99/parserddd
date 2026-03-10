import json
import os
import subprocess
import tempfile
from datetime import datetime, timedelta

from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max

DDDPARSER_PATH = os.environ.get('DDDPARSER_PATH', 'dddparser')


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
            card_id = block.get('card_identification', {})
            holder = block.get('driver_card_holder_identification', {})
            info['card_number'] = card_id.get('card_number', '')
            info['card_issuing_authority'] = card_id.get('card_issuing_authority_name', '')
            info['card_issue_date'] = card_id.get('card_issue_date')
            info['card_expiry_date'] = card_id.get('card_expiry_date')
            name = holder.get('card_holder_name', {})
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
        if activity and 'decoded_activity_daily_records' in activity:
            records.extend(activity['decoded_activity_daily_records'])
    return records


def get_vehicle_records(data):
    """Extract vehicle usage records from parsed data."""
    vehicles = []
    seen = set()
    for key in ['card_vehicles_used_1', 'card_vehicles_used_2']:
        block = data.get(key)
        if not block:
            continue
        for rec in block.get('card_vehicle_records', []):
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
    """Build continuous timeline of (start_dt, end_dt, work_type) from daily records."""
    all_intervals = []
    sorted_records = sorted(records, key=lambda r: r.get('activity_record_date', ''))
    for record in sorted_records:
        date_str = record.get('activity_record_date')
        if not date_str:
            continue
        base_date = datetime.strptime(date_str[:10], '%Y-%m-%d')
        changes = record.get('activity_change_info') or []
        for i, change in enumerate(changes):
            start_min = change['minutes']
            work_type = change['work_type']
            end_min = changes[i + 1]['minutes'] if i + 1 < len(changes) else 1440
            if end_min > start_min:
                start_dt = base_date + timedelta(minutes=start_min)
                end_dt = base_date + timedelta(minutes=end_min)
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

    Night ranges (only for work_type > 0):
      - 20:00-06:00 is the full night window
      - 20:00-24:00 => always 25%
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

            # 20:00-00:00 => always 25%
            nr_start = day_base + timedelta(hours=20)
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
    total_night_25_minutes = 0
    total_night_40_minutes = 0
    diet_count = 0

    for shift_intervals in shifts:
        if not shift_intervals:
            continue

        shift_start = shift_intervals[0][0]
        shift_end = shift_intervals[-1][1]

        # Work time = non-break intervals
        work_sec = sum(
            (end - start).total_seconds()
            for start, end, wt in shift_intervals if wt > 0
        )
        work_minutes = int(round(work_sec / 60))

        # Duration (start to end including breaks)
        duration_minutes = int(round((shift_end - shift_start).total_seconds() / 60))

        # Night hours (40% only if shift started before midnight)
        night_25, night_40 = calculate_shift_night_hours(shift_intervals, shift_start)

        total_work_minutes += work_minutes
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


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
