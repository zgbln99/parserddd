"""
DDD file parsing — subprocess calls to external parsers.

Supports two parser engines:
- tachoparser (traconiq/tachoparser) — default
- tachograph-go — alternative Go-based parser
"""

import json
import subprocess

from .constants import REST, AVAILABILITY, WORK, DRIVING, TACHOGRAPH_GO_ACTIVITY_MAP
from config import DDDPARSER_PATH, TACHOGRAPH_GO_PATH


def parse_ddd_file(file_path):
    """Parse DDD file using tachoparser (dddparser CLI)."""
    result = subprocess.run(
        [DDDPARSER_PATH, '-card', '-format', '-input', file_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Parser error: {result.stderr}")
    return json.loads(result.stdout)


def parse_ddd_file_tachograph_go(file_path):
    """Parse DDD file using tachograph-go and convert to our internal format."""
    result = subprocess.run(
        [TACHOGRAPH_GO_PATH, 'parse', file_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"tachograph-go error: {result.stderr}")
    raw = json.loads(result.stdout)
    return _convert_tachograph_go_output(raw)


def parse_ddd_auto(file_path, config_loader=None):
    """Parse DDD file using the configured parser engine.

    Args:
        file_path: Path to the DDD file.
        config_loader: Callable that returns config dict.
            If None, defaults to tachoparser engine.
    """
    engine = 'tachoparser'
    if config_loader:
        cfg = config_loader()
        engine = cfg.get('parser_engine', 'tachoparser')
    if engine == 'tachograph-go':
        return parse_ddd_file_tachograph_go(file_path)
    return parse_ddd_file(file_path)


# ---------------------------------------------------------------------------
# tachograph-go output conversion
# ---------------------------------------------------------------------------

def _tg_convert_vehicles(dc):
    """Convert tachograph-go vehicle records to tachoparser format."""
    vehicles_section = dc.get('vehiclesUsed', {})
    records = vehicles_section.get('records', [])
    converted = []
    for rec in records:
        reg = rec.get('vehicleRegistration', {})
        plate = reg.get('number', {}).get('value', '').strip()
        if not plate:
            continue
        converted.append({
            'vehicle_registration': {
                'vehicle_registration_number': plate,
            },
            'vehicle_first_use': rec.get('vehicleFirstUse', '') or '',
            'vehicle_last_use': rec.get('vehicleLastUse', '') or '',
            'vehicle_odometer_begin': rec.get('vehicleOdometerBeginKm', 0),
            'vehicle_odometer_end': rec.get('vehicleOdometerEndKm', 0),
        })
    return converted


def _tg_convert_places(dc):
    """Convert tachograph-go place records to tachoparser format."""
    places_section = dc.get('places', {})
    records = places_section.get('records', [])
    converted = []
    type_map = {'END': 'end', 'BEGIN': 'start'}
    for rec in records:
        entry_time = rec.get('entryTime', '')
        country = rec.get('dailyWorkPeriodCountry', '')
        region = rec.get('dailyWorkPeriodRegion', '')
        raw_type = rec.get('entryTypeDailyWorkPeriod', '')
        converted.append({
            'entry_time': entry_time or '',
            'date': entry_time or '',
            'country': country,
            'region': region,
            'type': type_map.get(raw_type, raw_type.lower() if raw_type else ''),
        })
    return converted


def _tg_convert_events(dc):
    """Convert tachograph-go event records to tachoparser format."""
    events_section = dc.get('eventsData', dc.get('eventsAndFaults', {}))
    records = events_section.get('events', events_section.get('records', []))
    return records  # pass through; get_card_events will handle gracefully


def _convert_tachograph_go_output(raw):
    """Convert tachograph-go JSON to our internal format compatible with analyze_card."""
    dc = raw.get('driverCard', {}).get('tachograph', {})

    # Driver info
    ident = dc.get('identification', {})

    # Activity records — convert and ensure cross-midnight continuity
    activity_data = dc.get('driverActivityData', {})
    daily_records = activity_data.get('dailyRecords', [])
    converted_records = []
    prev_day_last_state = None  # (work_type, card_present) from end of previous day

    for rec in daily_records:
        if not rec.get('valid', True):
            continue
        driver_changes = []
        for ci in rec.get('activityChangeInfo', []):
            # Only process DRIVER_SLOT entries (ignore CO_DRIVER_SLOT)
            if ci.get('slot') != 'DRIVER_SLOT':
                continue
            driver_changes.append(ci)

        changes = []
        if driver_changes:
            first_min = driver_changes[0].get('timeOfChangeMinutes', 0)

            # If first entry is NOT at minute 0, the card was still inserted
            # from the previous day — carry over the last known state.
            # This is how GloboFleet handles cross-midnight continuity.
            if first_min > 0 and prev_day_last_state is not None:
                changes.append({
                    'minutes': 0,
                    'work_type': prev_day_last_state[0],
                    'card_present': prev_day_last_state[1],
                })

            for ci in driver_changes:
                changes.append({
                    'minutes': ci.get('timeOfChangeMinutes', 0),
                    'work_type': TACHOGRAPH_GO_ACTIVITY_MAP.get(ci.get('activity', 'BREAK_REST'), REST),
                    'card_present': ci.get('inserted', False),
                })

            # Remember last state for next day's cross-midnight continuity
            last_ci = driver_changes[-1]
            prev_day_last_state = (
                TACHOGRAPH_GO_ACTIVITY_MAP.get(last_ci.get('activity', 'BREAK_REST'), REST),
                last_ci.get('inserted', False),
            )
        else:
            # No driver changes — if we have previous state, carry it for full day
            if prev_day_last_state is not None:
                changes.append({
                    'minutes': 0,
                    'work_type': prev_day_last_state[0],
                    'card_present': prev_day_last_state[1],
                })

        converted_records.append({
            'activity_record_date': rec.get('activityRecordDate', ''),
            'activity_change_info': changes,
        })

    # Build the structure that our existing code expects
    holder_birth = ident.get('cardHolderBirthDate', '')
    if isinstance(holder_birth, dict):
        holder_birth = holder_birth.get('date', '')

    return {
        'card_identification_and_driver_card_holder_identification_1': {
            'card_identification': {
                'card_number': ident.get('driverIdentification', {}).get('driverIdentificationNumber', {}).get('value', ''),
                'card_issuing_authority_name': ident.get('cardIssuingAuthorityName', {}).get('value', ''),
                'card_issue_date': ident.get('cardIssueDate', '') or '',
                'card_expiry_date': ident.get('cardExpiryDate', '') or '',
            },
            'driver_card_holder_identification': {
                'card_holder_name': {
                    'holder_surname': ident.get('cardHolderSurname', {}).get('value', ''),
                    'holder_first_names': ident.get('cardHolderFirstNames', {}).get('value', ''),
                },
                'card_holder_birth_date': holder_birth,
            },
        },
        'card_driver_activity_1': {
            'decoded_activity_daily_records': converted_records,
        },
        'card_vehicles_used_1': {
            'card_vehicle_records': _tg_convert_vehicles(dc),
        },
        'card_places_1': {
            'place_records': _tg_convert_places(dc),
        },
        'card_events_and_faults_1': {
            'card_event_records': _tg_convert_events(dc),
        },
    }
