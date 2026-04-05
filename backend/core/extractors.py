"""
Data extraction from parsed DDD structures.

These functions extract driver info, activity records, places, events,
and vehicle records from the tachoparser/tachograph-go output format.
"""

import json
import logging

from .constants import REST, AVAILABILITY, WORK, DRIVING, UNKNOWN

logger = logging.getLogger('ddd-reader')

# ---------------------------------------------------------------------------
# Priority ranking for minute-level merge of same-day activity records.
# Higher tuple = wins when two records cover the same minute.
# ---------------------------------------------------------------------------

_WORK_TYPE_PRIORITY = {
    DRIVING: 4,
    WORK: 3,
    AVAILABILITY: 2,
    REST: 1,
    UNKNOWN: 0,
}


def _minute_priority(work_type, card_present):
    """Return a comparison tuple for a single minute's state.

    Ranking (highest wins):
      1. card_present=True  >  card_present=False
      2. real activity       >  UNKNOWN
      3. DRIVING > WORK > AVAILABILITY > REST > UNKNOWN
    """
    return (
        1 if card_present else 0,
        1 if work_type != UNKNOWN else 0,
        _WORK_TYPE_PRIORITY.get(work_type, 0),
    )


def _expand_changes_to_minutes(changes):
    """Expand a sparse activity_change_info list into a 1440-element array.

    Each element is ``(work_type, card_present)``.
    Minutes before the first change entry are filled as ``(UNKNOWN, False)``.
    """
    minutes = [(UNKNOWN, False)] * 1440
    if not changes:
        return minutes

    sorted_changes = sorted(changes, key=lambda c: c.get('minutes', 0))
    for idx, ch in enumerate(sorted_changes):
        start = max(0, min(int(ch.get('minutes', 0)), 1439))
        end = (
            max(0, min(int(sorted_changes[idx + 1].get('minutes', 0)), 1440))
            if idx + 1 < len(sorted_changes)
            else 1440
        )
        wt = ch.get('work_type', UNKNOWN)
        cp = ch.get('card_present', False)
        if not isinstance(cp, bool):
            cp = False
        for m in range(start, end):
            minutes[m] = (wt, cp)
    return minutes


def _minutes_to_changes(minutes):
    """Compress a 1440-element minute array back to activity_change_info.

    Only emits an entry when the state actually changes (or at minute 0).
    """
    changes = []
    prev = None
    for m, state in enumerate(minutes):
        if state != prev:
            wt, cp = state
            changes.append({
                'minutes': m,
                'work_type': wt,
                'card_present': cp,
            })
            prev = state
    return changes


def merge_daily_activity_records(records_for_same_day):
    """Merge multiple activity records for the same day into one.

    For each minute 0..1439, picks the state with the highest priority
    across all input records.  Priority: card_present=True > False,
    real activity > UNKNOWN, DRIVING > WORK > AVAILABILITY > REST > UNKNOWN.

    Returns a single record dict with merged ``activity_change_info``.
    """
    if not records_for_same_day:
        return None
    if len(records_for_same_day) == 1:
        return records_for_same_day[0]

    date_str = records_for_same_day[0].get('activity_record_date', '')

    # Expand each record to 1440-minute arrays
    all_minute_arrays = []
    for rec in records_for_same_day:
        changes = rec.get('activity_change_info') or []
        all_minute_arrays.append(_expand_changes_to_minutes(changes))

    total_changes_before = sum(
        len(rec.get('activity_change_info') or []) for rec in records_for_same_day
    )

    # Merge: for each minute pick best state across all records
    merged_minutes = [(UNKNOWN, False)] * 1440
    conflict_count = 0

    for m in range(1440):
        best_state = (UNKNOWN, False)
        best_prio = _minute_priority(UNKNOWN, False)
        states_at_m = set()

        for arr in all_minute_arrays:
            wt, cp = arr[m]
            states_at_m.add((wt, cp))
            prio = _minute_priority(wt, cp)
            if prio > best_prio:
                best_prio = prio
                best_state = (wt, cp)

        merged_minutes[m] = best_state

        # Count conflicts where manual was overridden by card_present=True
        if len(states_at_m) > 1:
            has_card_true = any(cp for _, cp in states_at_m)
            has_card_false = any(not cp for _, cp in states_at_m)
            if has_card_true and has_card_false:
                conflict_count += 1

    merged_changes = _minutes_to_changes(merged_minutes)

    logger.info(
        "Merged %d daily activity records for %s: "
        "%d total change entries before → %d after merge, %d manual-vs-card conflicts",
        len(records_for_same_day), date_str,
        total_changes_before, len(merged_changes), conflict_count,
    )

    # Build merged record, preserving any extra fields from the first record
    merged_record = dict(records_for_same_day[0])
    merged_record['activity_change_info'] = merged_changes
    return merged_record


def get_driver_info(data):
    """Extract driver identification from parsed DDD data."""
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
    """Extract daily activity records from tachoparser output.

    Uses ONLY card_driver_activity_1 (slot 1 = driver position).
    card_driver_activity_2 is the co-driver slot and contains activity
    recorded when this card was in the passenger/co-driver position.
    Co-driver activity must NOT be mixed into the driver's work hours.
    Falls back to _2 only if _1 is completely empty (rare edge case).
    """
    candidates = []

    # Primary: driver slot only
    activity_1 = data.get('card_driver_activity_1')
    if activity_1:
        recs = activity_1.get('decoded_activity_daily_records') or []
        candidates.extend(recs)

    # Fallback: if slot 1 is empty, try slot 2 (card may have been
    # used exclusively as co-driver in the requested period)
    if not candidates:
        activity_2 = data.get('card_driver_activity_2')
        if activity_2:
            recs = activity_2.get('decoded_activity_daily_records') or []
            candidates.extend(recs)

    if not candidates:
        return []

    def _norm_changes(rec):
        changes = rec.get('activity_change_info') or []
        norm = []
        for ch in changes:
            norm.append({
                'minutes': ch.get('minutes'),
                'work_type': ch.get('work_type'),
                'card_present': ch.get('card_present'),
            })
        return norm

    # Group candidates by date, dedup identical records, then merge
    by_date = {}  # date -> list of (signature, normalized_record)

    for rec in candidates:
        day = rec.get('activity_record_date', '')
        if not day:
            continue

        changes = _norm_changes(rec)
        sig = json.dumps(changes, sort_keys=True, ensure_ascii=False)

        if day not in by_date:
            by_date[day] = []

        # Skip exact duplicates (identical activity_change_info)
        existing_sigs = {s for s, _ in by_date[day]}
        if sig in existing_sigs:
            logger.warning("Duplicate identical daily activity record skipped for %s", day)
            continue

        # Store normalized changes back into a copy of the record
        rec_copy = dict(rec)
        rec_copy['activity_change_info'] = changes
        by_date[day].append((sig, rec_copy))

    # Merge records per day
    result = []
    for day in sorted(by_date.keys()):
        day_records = [rec for _, rec in by_date[day]]
        if len(day_records) > 1:
            logger.info(
                "Merging %d daily activity records for %s",
                len(day_records), day,
            )
            merged = merge_daily_activity_records(day_records)
        else:
            merged = day_records[0]
        if merged:
            result.append(merged)

    return result


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
    """Extract vehicle records with odometer data from DDD data."""
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
