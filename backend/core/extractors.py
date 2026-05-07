"""
Data extraction from parsed DDD structures.

These functions extract driver info, activity records, places, events,
and vehicle records from the tachoparser/tachograph-go output format.
"""

import json
import logging

from .constants import REST, AVAILABILITY, WORK, DRIVING

logger = logging.getLogger('ddd-reader')


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

    def _is_full_rest_day(rec):
        changes = rec.get('activity_change_info') or []
        if not changes:
            return False

        work_like = 0
        for ch in changes:
            wt = ch.get('work_type')
            if wt in (AVAILABILITY, WORK, DRIVING):
                work_like += 1

        return work_like == 0

    def _count_work_like_minutes(rec):
        changes = rec.get('activity_change_info') or []
        if not changes:
            return 0

        sorted_changes = sorted(changes, key=lambda c: c.get('minutes', 0))
        total = 0

        for i, ch in enumerate(sorted_changes):
            start_min = ch.get('minutes', 0)
            wt = ch.get('work_type')

            if i + 1 < len(sorted_changes):
                end_min = sorted_changes[i + 1].get('minutes', 1440)
            else:
                end_min = 1440

            if wt in (AVAILABILITY, WORK, DRIVING):
                total += max(0, end_min - start_min)
        return total

    by_date = {}

    for rec in candidates:
        day = rec.get('activity_record_date', '')
        if not day:
            continue

        changes = _norm_changes(rec)
        sig = json.dumps(changes, sort_keys=True, ensure_ascii=False)

        if day not in by_date:
            by_date[day] = {
                'record': rec,
                'signature': sig,
                'change_count': len(changes),
                'card_present_true_count': sum(1 for ch in changes if ch.get('card_present') is True),
            }
            continue

        prev = by_date[day]

        if prev['signature'] == sig:
            logger.warning("Duplicate identical daily activity record skipped for %s", day)
            continue

        new_change_count = len(changes)
        new_card_present_true_count = sum(1 for ch in changes if ch.get('card_present') is True)
        prev_is_full_rest = _is_full_rest_day(prev['record'])
        new_is_full_rest = _is_full_rest_day(rec)
        prev_work_like = _count_work_like_minutes(prev['record'])
        new_work_like = _count_work_like_minutes(rec)

        replace = False
        decision_reason = "kept existing by default"

        if prev_is_full_rest and not new_is_full_rest:
            replace = True
            decision_reason = "existing is full rest day, new has real activity"
        elif new_is_full_rest and not prev_is_full_rest:
            replace = False
            decision_reason = "new is full rest day, existing has real activity"
        elif new_work_like > prev_work_like:
            replace = True
            decision_reason = "new has more work-like minutes"
        elif new_work_like < prev_work_like:
            replace = False
            decision_reason = "existing has more work-like minutes"
        elif new_change_count > prev['change_count']:
            replace = True
            decision_reason = "new has more activity changes"
        elif new_change_count == prev['change_count'] and new_card_present_true_count > prev['card_present_true_count']:
            replace = True
            decision_reason = "new has more card_present=True changes"

        logger.warning(
            "Conflicting daily activity records for %s; keeping %s record (%s)",
            day,
            "newer/better" if replace else "existing",
            decision_reason,
        )

        if replace:
            by_date[day] = {
                'record': rec,
                'signature': sig,
                'change_count': new_change_count,
                'card_present_true_count': new_card_present_true_count,
            }

    return [v['record'] for _, v in sorted(by_date.items(), key=lambda kv: kv[0])]


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
            ob = int(odo_begin) if odo_begin else 0
            oe = int(odo_end) if odo_end else 0
            vehicles.append({
                'plate': plate,
                'first_use': first_use,
                'last_use': last_use,
                'odometer_begin_km': ob,
                'odometer_end_km': oe,
                'distance_km': max(0, oe - ob),
            })
    vehicles.sort(key=lambda v: v.get('first_use', ''))
    return vehicles
