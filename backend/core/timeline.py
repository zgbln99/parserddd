"""
Timeline construction from DDD activity records.

Converts per-day 1440-minute arrays into UTC-aware intervals,
merges cross-day boundaries, and fills gaps.

This is the foundation for shift detection and analysis.
All datetimes are UTC-aware.
"""

import logging
from datetime import datetime, timedelta

from .constants import (
    REST, AVAILABILITY, WORK, DRIVING, UNKNOWN,
    STRICT_GLOBOFLEET_MODE, UTC,
)

_log = logging.getLogger(__name__)


def build_timeline(records):
    """Build timeline using the 1440-minute-per-day model per DDD spec.

    Each tachograph day = 00:00-24:00 UTC, represented as 1440 minutes.
    The tachograph specification expects a state at minute 0. If the first
    entry is not at minute 0, strict Globofleet mode treats this period
    as REST/manual for compatibility.

    Returns list of intervals ``(start_dt, end_dt, work_type, card_out)``
    where all datetimes are UTC-aware.
    """
    sorted_records = [
        r for r in sorted(records, key=lambda r: r.get('activity_record_date', ''))
        if r.get('activity_record_date')
    ]
    if not sorted_records:
        return []

    all_day_minutes = []  # list of (base_date_utc_aware, minutes_array)

    for record in sorted_records:
        date_str = record['activity_record_date']
        base_date = datetime.strptime(date_str[:10], '%Y-%m-%d').replace(tzinfo=UTC)
        changes = record.get('activity_change_info') or []
        if not changes:
            continue

        # 1440-minute array; default UNKNOWN until filled by real data
        minutes = [(UNKNOWN, True)] * 1440

        sorted_changes = sorted(changes, key=lambda c: c.get('minutes', 0))

        # Validate: first entry should be at minute 0 (tachograph always records 00:00 state)
        first_minute = sorted_changes[0].get('minutes', -1)
        if first_minute != 0:
            if STRICT_GLOBOFLEET_MODE:
                _log.warning(
                    'Day %s: first activity_change_info entry at minute %d, not 0. '
                    'State from 00:00 to minute %d is treated as REST/manual for Globofleet compatibility.',
                    date_str[:10], first_minute, first_minute
                )
                current_wt = REST
                current_card_out = True
            else:
                _log.warning(
                    'Day %s: first activity_change_info entry at minute %d, not 0. '
                    'State from 00:00 to minute %d is UNKNOWN.',
                    date_str[:10], first_minute, first_minute
                )
                # Fill 00:00..first_change as UNKNOWN (no data for this period)
                current_wt = UNKNOWN
                current_card_out = True
            current_minute = 0
        else:
            first_wt = sorted_changes[0].get('work_type', REST)
            first_cp = sorted_changes[0].get('card_present', True)
            # Smart start-of-day logic (mirrors end-of-day):
            # If minute 0 is WORK/DRIVING and the next change is far away
            # (>2h), this is a retroactive filler — treat as UNKNOWN.
            # AVAILABILITY is excluded: co-drivers legitimately have long
            # AVAILABILITY stretches (entire day as passenger).
            # If REST or small gap: keep as-is.
            second_minute = sorted_changes[1].get('minutes', 0) if len(sorted_changes) > 1 else 0
            if first_wt in (WORK, DRIVING) and second_minute > 120:
                current_wt = UNKNOWN
                current_card_out = True
            else:
                current_wt = first_wt
                current_card_out = not first_cp
            current_minute = 0

        current_manual = current_card_out

        _seen_minutes = set()
        for change in sorted_changes:
            raw_minute = change.get('minutes', 0)
            if not isinstance(raw_minute, int) or raw_minute < 0 or raw_minute > 1439:
                _log.warning(
                    'Day %s: invalid minute value %r, clamping to 0..1439', date_str[:10], raw_minute)
            target_minute = max(0, min(int(raw_minute) if isinstance(raw_minute, (int, float)) else 0, 1439))
            if target_minute in _seen_minutes:
                _log.warning(
                    'Day %s: duplicate entry at minute %d', date_str[:10], target_minute)
            _seen_minutes.add(target_minute)
            raw_wt = change.get('work_type', REST)
            if raw_wt not in (REST, AVAILABILITY, WORK, DRIVING):
                _log.warning(
                    'Day %s: invalid work_type %r at minute %d, treating as UNKNOWN',
                    date_str[:10], raw_wt, target_minute)
                wt = UNKNOWN
            else:
                wt = raw_wt
            cp = change.get('card_present', True)
            if not isinstance(cp, bool):
                _log.warning(
                    'Day %s minute %d: card_present is %r (type %s), expected bool. Defaulting to True.',
                    date_str[:10], target_minute, cp, type(cp).__name__)
                cp = True
            manual = not cp

            for m in range(current_minute, target_minute):
                minutes[m] = (current_wt, current_manual)

            current_wt = wt
            current_manual = manual
            current_minute = target_minute

        # Fill remaining minutes after last activity change.
        # Smart logic:
        # - REST/UNKNOWN at end of day: keep as-is (natural state)
        # - WORK/DRIVING at end of day with large gap (>2h) to midnight:
        #   likely driver forgot to switch -> UNKNOWN
        # - AVAILABILITY excluded: co-drivers legitimately have long
        #   AVAILABILITY stretches that can run to end of day.
        # - WORK/DRIVING with small gap (<=2h): keep (legitimate retroactive entry)
        remaining_minutes = 1440 - current_minute
        if current_wt in (WORK, DRIVING) and remaining_minutes > 120:
            for m in range(current_minute, 1440):
                minutes[m] = (UNKNOWN, True)
        else:
            for m in range(current_minute, 1440):
                minutes[m] = (current_wt, current_manual)

        # Invariant checks
        assert len(minutes) == 1440, f'Day {date_str[:10]}: minute array has {len(minutes)} entries, expected 1440'
        assert all(m is not None for m in minutes), f'Day {date_str[:10]}: minute array has None entries'

        all_day_minutes.append((base_date, minutes))

    # Convert minute arrays to UTC-aware intervals
    all_intervals = []
    for base_date, minutes in all_day_minutes:
        i = 0
        while i < 1440:
            wt, manual = minutes[i]
            j = i + 1
            while j < 1440 and minutes[j] == (wt, manual):
                j += 1
            start_dt = base_date + timedelta(minutes=i)
            end_dt = base_date + timedelta(minutes=j)
            all_intervals.append((start_dt, end_dt, wt, manual))
            i = j

    merged_intervals = _merge_cross_day_intervals(all_intervals)

    # Post-process: WORK intervals > 2h immediately after UNKNOWN
    # are retroactive fills across day boundaries — convert to UNKNOWN.
    # AVAILABILITY is excluded: co-drivers legitimately have long
    # AVAILABILITY stretches after card-out / UNKNOWN gaps.
    cleaned = list(merged_intervals)
    for idx in range(1, len(cleaned)):
        prev_s, prev_e, prev_wt, prev_m = cleaned[idx - 1]
        cur_s, cur_e, cur_wt, cur_m = cleaned[idx]
        dur_min = (cur_e - cur_s).total_seconds() / 60
        if prev_wt == UNKNOWN and cur_wt == WORK and dur_min > 120 and not cur_m:
            cleaned[idx] = (cur_s, cur_e, UNKNOWN, True)

    return _validate_timeline(cleaned)


def _validate_timeline(intervals):
    """Validate merged timeline: monotonic, non-overlapping, valid states."""
    _VALID_STATES = (REST, AVAILABILITY, WORK, DRIVING, UNKNOWN)
    for i, (s, e, wt, co) in enumerate(intervals):
        if e <= s:
            _log.warning('Timeline: interval %d has zero/negative length (%s to %s)', i, s, e)
        if wt not in _VALID_STATES:
            _log.warning('Timeline: interval %d has unknown work_type %r', i, wt)
        if i > 0:
            prev_end = intervals[i - 1][1]
            if s < prev_end:
                _log.warning('Timeline overlap: interval %d ends at %s but %d starts at %s', i - 1, prev_end, i, s)
            elif s > prev_end:
                _log.warning('Timeline gap after merge: interval %d ends at %s, %d starts at %s', i - 1, prev_end, i, s)
    return intervals


def _merge_cross_day_intervals(intervals):
    """Merge intervals across day boundaries when state is identical.

    Merging only happens when start == prev_end exactly (no tolerance).
    """
    if not intervals:
        return []
    result = [list(intervals[0])]
    for start, end, wt, manual in intervals[1:]:
        prev = result[-1]
        if prev[2] == wt and prev[3] == manual and start == prev[1]:
            prev[1] = end
        else:
            result.append([start, end, wt, manual])
    return [(s, e, w, m) for s, e, w, m in result]


def merge_intervals(intervals):
    """Merge adjacent intervals with identical state (exact boundary match)."""
    if not intervals:
        return []
    merged = [list(intervals[0])]
    for start, end, wt, manual in intervals[1:]:
        prev = merged[-1]
        if prev[2] == wt and prev[3] == manual and start == prev[1]:
            prev[1] = end
        else:
            merged.append([start, end, wt, manual])
    return [(s, e, w, m) for s, e, w, m in merged]


def fill_timeline_gaps(intervals):
    """Fill gaps between recorded days with UNKNOWN intervals.

    Business assumption: gaps between days where no tachograph record exists
    represent periods when the driver card was out of the unit.  These are
    marked as UNKNOWN (``manual=True``) so that shift-boundary detection can
    identify daily rest periods correctly.  GloboFleet labels these as
    "? Unbekannt".
    """
    if len(intervals) < 2:
        return list(intervals)
    result = [intervals[0]]
    for i in range(1, len(intervals)):
        prev_end = result[-1][1]
        curr_start = intervals[i][0]
        gap_sec = (curr_start - prev_end).total_seconds()
        if gap_sec > 0:
            # Mark as manual=True to indicate unknown/card-out period
            result.append((prev_end, curr_start, UNKNOWN, True))
        result.append(intervals[i])
    return result
