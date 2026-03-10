import json
import os
import subprocess
import tempfile
from collections import defaultdict
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


def calculate_work_minutes_for_day(activity_changes):
    """Calculate work minutes from activity changes for a single day.

    Returns a list of (start_minutes, end_minutes, work_type) intervals.
    work_type: 0=break, 1=on duty, 2=work, 3=drive
    """
    if not activity_changes:
        return []

    intervals = []
    for i in range(len(activity_changes)):
        change = activity_changes[i]
        start_min = change['minutes']
        work_type = change['work_type']

        if i + 1 < len(activity_changes):
            end_min = activity_changes[i + 1]['minutes']
        else:
            end_min = 1440  # end of day

        if end_min > start_min:
            intervals.append((start_min, end_min, work_type))

    return intervals


def calc_night_overlap(intervals, night_25_ranges, night_40_ranges):
    """Calculate night hour overlaps for given intervals and night ranges."""
    night_25 = 0
    night_40 = 0
    for start, end, work_type in intervals:
        if work_type == 0:
            continue
        for nr_start, nr_end in night_25_ranges:
            o_start = max(start, nr_start)
            o_end = min(end, nr_end)
            if o_end > o_start:
                night_25 += o_end - o_start
        for nr_start, nr_end in night_40_ranges:
            o_start = max(start, nr_start)
            o_end = min(end, nr_end)
            if o_end > o_start:
                night_40 += o_end - o_start
    return night_25, night_40


def is_working_at_midnight(intervals):
    """Check if work continues at midnight (end of day)."""
    if not intervals:
        return False
    last_start, last_end, last_wt = intervals[-1]
    return last_end >= 1440 and last_wt > 0


def get_morning_continuation(intervals):
    """Get work intervals from 00:00 until first break on the next day.
    Returns work intervals that are part of previous day's shift."""
    morning = []
    for start, end, work_type in intervals:
        if work_type == 0:  # break - shift ended
            break
        morning.append((start, end, work_type))
    return morning


def minutes_to_hm(minutes):
    """Convert minutes to H:MM format."""
    h = minutes // 60
    m = minutes % 60
    return f"{h}:{m:02d}"


def minutes_to_decimal(minutes):
    """Convert minutes to decimal hours."""
    return round(minutes / 60, 2)


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
            # Deduplicate by plate+dates
            dedup_key = (plate, first_use, last_use)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            vehicles.append({
                'plate': plate,
                'first_use': first_use,
                'last_use': last_use,
            })
    # Sort by first_use date
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


def analyze_card(data):
    """Analyze driver card data and return summary statistics.

    Shift-based logic: if a driver works through midnight (shift continues
    from day N into day N+1), the morning continuation on day N+1 (until
    first break) is attributed to day N's shift for both work time and
    night hours.
    """
    driver_info = get_driver_info(data)
    records = get_activity_records(data)
    vehicles = get_vehicle_records(data)

    NIGHT_25_EVENING = [(1320, 1440)]   # 22:00-00:00
    NIGHT_25_MORNING = [(240, 360)]     # 04:00-06:00
    NIGHT_40_RANGES = [(0, 240)]        # 00:00-04:00

    # Build date -> intervals map, sorted by date
    day_intervals = {}
    day_dates = []
    for record in records:
        date_str = record.get('activity_record_date')
        if not date_str:
            continue
        changes = record.get('activity_change_info', [])
        intervals = calculate_work_minutes_for_day(changes)
        day_intervals[date_str] = intervals
        day_dates.append(date_str)

    day_dates.sort()

    # Track morning data borrowed by previous day's shift
    # morning_borrowed[date] = work_minutes borrowed
    morning_borrowed = {}

    daily_details = []
    total_work_minutes = 0
    total_night_25_minutes = 0
    total_night_40_minutes = 0
    diet_count = 0

    for i, date_str in enumerate(day_dates):
        intervals = day_intervals[date_str]

        # Base work for this calendar day (work_type 1, 2, 3)
        day_work_minutes = sum(
            end - start for start, end, wt in intervals if wt > 0
        )

        # Subtract morning minutes that were borrowed by previous day
        if date_str in morning_borrowed:
            day_work_minutes -= morning_borrowed[date_str]

        # Night hours from THIS day's evening (22:00-00:00)
        night_25, _ = calc_night_overlap(intervals, NIGHT_25_EVENING, [])

        # Night hours from THIS day's morning (00:00-06:00)
        # Only count if NOT already borrowed by previous day's shift
        night_40 = 0
        if date_str not in morning_borrowed:
            morning_n25, night_40 = calc_night_overlap(
                intervals, NIGHT_25_MORNING, NIGHT_40_RANGES
            )
            night_25 += morning_n25

        # If work continues at midnight, borrow next day's morning
        if is_working_at_midnight(intervals) and i + 1 < len(day_dates):
            next_date = day_dates[i + 1]
            try:
                curr = datetime.strptime(date_str, '%Y-%m-%d')
                nxt = datetime.strptime(next_date, '%Y-%m-%d')
                if (nxt - curr).days == 1:
                    next_intervals = day_intervals[next_date]
                    morning = get_morning_continuation(next_intervals)
                    if morning:
                        # Borrow work time
                        borrowed_work = sum(
                            end - start for start, end, wt in morning if wt > 0
                        )
                        day_work_minutes += borrowed_work
                        morning_borrowed[next_date] = borrowed_work

                        # Borrow night hours (only 00:00-06:00 portion)
                        morning_night = [
                            (s, min(e, 360), wt)
                            for s, e, wt in morning if s < 360
                        ]
                        mn25, mn40 = calc_night_overlap(
                            morning_night, NIGHT_25_MORNING, NIGHT_40_RANGES
                        )
                        night_25 += mn25
                        night_40 += mn40
            except ValueError:
                pass

        total_work_minutes += day_work_minutes
        total_night_25_minutes += night_25
        total_night_40_minutes += night_40

        if day_work_minutes > 8 * 60:
            diet_count += 1

        # Find vehicle(s) used on this day
        day_date = parse_date_safe(date_str)
        day_plates = []
        for v in vehicles:
            v_start = parse_date_safe(v.get('first_use', ''))
            v_end = parse_date_safe(v.get('last_use', ''))
            if v_start and v_end and day_date:
                if v_start <= day_date <= v_end:
                    day_plates.append(v['plate'])
        seen_plates = set()
        unique_plates = []
        for p in day_plates:
            if p not in seen_plates:
                seen_plates.add(p)
                unique_plates.append(p)

        daily_details.append({
            'date': date_str,
            'work_minutes': day_work_minutes,
            'work_hm': minutes_to_hm(day_work_minutes),
            'work_decimal': minutes_to_decimal(day_work_minutes),
            'night_25_minutes': night_25,
            'night_25_hm': minutes_to_hm(night_25),
            'night_40_minutes': night_40,
            'night_40_hm': minutes_to_hm(night_40),
            'has_diet': day_work_minutes > 8 * 60,
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
            'total_days': len(daily_details),
        },
        'daily_details': daily_details,
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
