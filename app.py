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
            surname = holder.get('holder_surname', '')
            first_name = holder.get('holder_first_names', '')
            info['driver_name'] = f"{surname} {first_name}".strip()
            info['birth_date'] = holder.get('holder_birth_date')
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


def calculate_night_hours(intervals):
    """Calculate night hours from work intervals.

    Night 25%: 22:00-00:00 (1320-1440) and 04:00-06:00 (240-360)
    Night 40%: 00:00-04:00 (0-240)

    Only counts work types 1 (on duty), 2 (work), 3 (drive).
    """
    night_25_minutes = 0
    night_40_minutes = 0

    night_25_ranges = [(1320, 1440), (240, 360)]  # 22:00-00:00, 04:00-06:00
    night_40_ranges = [(0, 240)]  # 00:00-04:00

    for start, end, work_type in intervals:
        if work_type == 0:  # break - skip
            continue

        # Night 25%
        for nr_start, nr_end in night_25_ranges:
            overlap_start = max(start, nr_start)
            overlap_end = min(end, nr_end)
            if overlap_end > overlap_start:
                night_25_minutes += overlap_end - overlap_start

        # Night 40%
        for nr_start, nr_end in night_40_ranges:
            overlap_start = max(start, nr_start)
            overlap_end = min(end, nr_end)
            if overlap_end > overlap_start:
                night_40_minutes += overlap_end - overlap_start

    return night_25_minutes, night_40_minutes


def minutes_to_hm(minutes):
    """Convert minutes to H:MM format."""
    h = minutes // 60
    m = minutes % 60
    return f"{h}:{m:02d}"


def minutes_to_decimal(minutes):
    """Convert minutes to decimal hours."""
    return round(minutes / 60, 2)


def analyze_card(data):
    """Analyze driver card data and return summary statistics."""
    driver_info = get_driver_info(data)
    records = get_activity_records(data)

    daily_details = []
    total_work_minutes = 0
    total_night_25_minutes = 0
    total_night_40_minutes = 0
    diet_count = 0

    for record in records:
        date_str = record.get('activity_record_date')
        if not date_str:
            continue

        changes = record.get('activity_change_info', [])
        intervals = calculate_work_minutes_for_day(changes)

        # Total work for the day (work_type 1, 2, 3)
        day_work_minutes = sum(
            end - start for start, end, wt in intervals if wt > 0
        )

        night_25, night_40 = calculate_night_hours(intervals)

        total_work_minutes += day_work_minutes
        total_night_25_minutes += night_25
        total_night_40_minutes += night_40

        # Diet: each day with >8h work = 1 diet
        if day_work_minutes > 8 * 60:
            diet_count += 1

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
        })

    # Sort by date
    daily_details.sort(key=lambda x: x['date'])

    total_night_minutes = total_night_25_minutes + total_night_40_minutes

    return {
        'driver_info': driver_info,
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
