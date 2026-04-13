"""
Shift detection, night hour calculation, and minute bucket operations.

All datetime arguments and return values are UTC-aware.
CET is used only for business-rule decisions (night windows, shift splitting).
"""

from datetime import datetime, timedelta

from .constants import (
    REST, AVAILABILITY, WORK, DRIVING, UNKNOWN,
    STRICT_GLOBOFLEET_MODE,
    _is_rest_like_for_shift_split, _is_break_like_for_reporting,
)
from .utils import _to_cet
from .timeline import merge_intervals, fill_timeline_gaps
from .constants import UTC, CET


def detect_shifts(all_intervals, min_rest_hours=5):
    """Split a continuous timeline into driver shifts (BUSINESS HEURISTIC).

    Shift-splitting rules (matching GloboFleet behavior):
    - A rest >= 9h (valid EU daily rest) ALWAYS splits, even within the same CET day.
    - A rest >= *min_rest_hours* (default 5h) but < 9h splits only if it starts/ends
      on a different CET calendar day than the current shift's first work activity.
    """
    if not all_intervals:
        return []
    merged = merge_intervals(all_intervals)
    merged = fill_timeline_gaps(merged)
    min_rest_sec = min_rest_hours * 3600
    shifts = []
    current = []
    current_shift_start_cet_date = None  # CET date of first work in current shift

    i = 0
    while i < len(merged):
        start, end, wt, manual = merged[i]

        # Track the CET date of the first work activity in current shift
        if wt not in (REST, UNKNOWN) and current_shift_start_cet_date is None:
            current_shift_start_cet_date = _to_cet(start).date()

        if _is_rest_like_for_shift_split(wt):
            rest_begin = start
            rest_end = end
            j = i + 1
            while j < len(merged):
                nxt_s, nxt_e, nxt_wt, nxt_manual = merged[j]
                if nxt_s != rest_end:
                    break
                if _is_rest_like_for_shift_split(nxt_wt):
                    rest_end = nxt_e
                    j += 1
                else:
                    break

            effective_rest = (rest_end - rest_begin).total_seconds()
            if effective_rest >= min_rest_sec:
                # A rest >= 9h is a valid EU daily rest — always split.
                # Shorter rests (5h–9h) only split across CET day boundaries.
                daily_rest_sec = 9 * 3600
                if effective_rest >= daily_rest_sec:
                    should_split = True
                else:
                    rest_begin_cet_date = _to_cet(rest_begin).date()
                    rest_end_cet_date = _to_cet(rest_end).date()
                    should_split = (
                        current_shift_start_cet_date is None
                        or rest_begin_cet_date != current_shift_start_cet_date
                        or rest_end_cet_date != current_shift_start_cet_date
                    )
                if should_split:
                    if current:
                        shifts.append(current)
                        current = []
                    current_shift_start_cet_date = None
                    i = j
                    continue

        current.append(merged[i])
        i += 1

    if current:
        shifts.append(current)
    return shifts


# ---------------------------------------------------------------------------
# Night hour calculation
# ---------------------------------------------------------------------------

def _build_night_windows(earliest_utc, latest_utc, night_start_hour=22):
    """Build night windows as UTC-aware datetimes using CET business hours.

    Night windows in CET for each calendar date:
      night_start_hour:00 -> 00:00 next day  = 25%
      00:00 -> 04:00                          = 'check' (40% or 25% depending on shift start)
      04:00 -> 06:00                          = 25%

    Uses a bounded for-loop over CET dates to avoid infinite loops.
    Returns list of (start_utc, end_utc, category) with UTC-aware datetimes.
    """
    windows = []
    # Convert to CET to determine which CET dates to iterate
    cet_start = _to_cet(earliest_utc) - timedelta(days=1)
    cet_end = _to_cet(latest_utc) + timedelta(days=1)
    start_date = cet_start.date()
    end_date = cet_end.date()
    num_days = (end_date - start_date).days + 1

    for day_offset in range(num_days):
        d = start_date + timedelta(days=day_offset)
        # CET-aware midnight for this date
        cet_midnight = datetime(d.year, d.month, d.day, tzinfo=CET)

        # 1) night_start_hour:00 CET -> 00:00 CET next day (25%)
        w1_start = cet_midnight.replace(hour=night_start_hour).astimezone(UTC)
        w1_end = (cet_midnight + timedelta(days=1)).astimezone(UTC)
        windows.append((w1_start, w1_end, '25'))

        # 2) 00:00 -> 04:00 CET (check shift_start for 40% vs 25%)
        w2_start = cet_midnight.astimezone(UTC)
        w2_end = cet_midnight.replace(hour=4).astimezone(UTC)
        windows.append((w2_start, w2_end, 'check'))

        # 3) 04:00 -> 06:00 CET (25%)
        w3_start = cet_midnight.replace(hour=4).astimezone(UTC)
        w3_end = cet_midnight.replace(hour=6).astimezone(UTC)
        windows.append((w3_start, w3_end, '25'))

    return windows


def calculate_shift_night_hours(minute_buckets, shift_start, night_start_hour=22, night_40_check_midnight=True):
    """Calculate night work minutes using CET night windows on UTC timeline.

    Args:
        night_40_check_midnight: If True (default), 00:00-04:00 is 40% only when
            shift started before midnight, otherwise 25%. If False, 00:00-04:00
            is always 40%.

    Returns (night_25_minutes, night_40_minutes).
    """
    if not minute_buckets:
        return 0, 0
    night_25 = 0
    night_40 = 0

    if STRICT_GLOBOFLEET_MODE:
        for dt, (work_type, _manual) in minute_buckets.items():
            if work_type in (REST, UNKNOWN):
                continue
            dt_cet = _to_cet(dt)
            hour = dt_cet.hour
            if night_start_hour <= hour <= 23:
                night_25 += 1
            elif 0 <= hour < 4:
                if not night_40_check_midnight:
                    night_40 += 1
                else:
                    cet_midnight = datetime(
                        dt_cet.year, dt_cet.month, dt_cet.day, tzinfo=CET
                    ).astimezone(UTC)
                    if shift_start < cet_midnight:
                        night_40 += 1
                    else:
                        night_25 += 1
            elif 4 <= hour < 6:
                night_25 += 1
        return night_25, night_40

    intervals = []
    for dt, (wt, m) in sorted(minute_buckets.items(), key=lambda kv: kv[0]):
        intervals.append((dt, dt + timedelta(minutes=1), wt, m))
    earliest = min(iv[0] for iv in intervals)
    latest = max(iv[1] for iv in intervals)
    windows = _build_night_windows(earliest, latest, night_start_hour)
    for interval in intervals:
        iv_start, iv_end, work_type = interval[0], interval[1], interval[2]
        if work_type in (REST, UNKNOWN):
            continue
        for w_start, w_end, category in windows:
            o_start = max(iv_start, w_start)
            o_end = min(iv_end, w_end)
            if o_end <= o_start:
                continue
            mins = int((o_end - o_start).total_seconds()) // 60
            if category == '25':
                night_25 += mins
            elif category == 'check':
                if not night_40_check_midnight:
                    night_40 += mins
                else:
                    # 00:00-04:00 CET: 40% if shift started before this CET midnight
                    cet_midnight_utc = w_start  # w_start IS CET 00:00 in UTC
                    if shift_start < cet_midnight_utc:
                        night_40 += mins
                    else:
                        night_25 += mins
    return night_25, night_40


# ---------------------------------------------------------------------------
# Minute bucket operations
# ---------------------------------------------------------------------------

def iter_tachograph_minutes(intervals):
    """
    Expand intervals into tachograph minute buckets.

    RULE (tachograph / Globofleet):
    - If any part of a minute contains activity, the whole minute counts.
    - start -> floor to minute
    - end   -> ceil to minute
    """
    _td1 = timedelta(minutes=1)
    for start, end, wt, card_out in intervals:
        if end <= start:
            continue

        # START: round DOWN (floor)
        minute_start = start.replace(second=0, microsecond=0)

        # END: round UP (ceil)
        minute_end = end.replace(second=0, microsecond=0)
        if minute_end < end:
            minute_end += _td1

        # Use integer count to avoid repeated timedelta additions
        count = int((minute_end - minute_start).total_seconds()) // 60
        for i in range(count):
            yield minute_start + timedelta(minutes=i), wt, card_out


def count_bucket_minutes_between(start, end):
    """Count tachograph minutes between two UTC-aware datetimes."""
    if end <= start:
        return 0
    minute_start = start.replace(second=0, microsecond=0)
    minute_end = end.replace(second=0, microsecond=0)
    if minute_end < end:
        minute_end += timedelta(minutes=1)
    return int((minute_end - minute_start).total_seconds()) // 60


def count_minutes_for_interval_from_buckets(start, end, target_wt, minute_buckets):
    """Count minutes of a specific work type within a time range from buckets."""
    return sum(
        1 for dt, (wt, _m) in minute_buckets.items()
        if start <= dt < end and wt == target_wt
    )


def split_day_bucket_into_work_blocks(day_bucket, rest_gap_threshold_minutes=15):
    """Split one CET local-day bucket into contiguous work shifts.

    Separates blocks by (1) missing minutes on the timeline and (2) long runs of
    REST/UNKNOWN (Globofleet-style rest separators). Long rest is not included
    at the start of the next block; the next block begins at the next work-like
    minute. Each returned dict is one shift segment for shift_details.
    """
    dts = sorted(day_bucket.keys())
    if not dts:
        return []

    _REAL = (AVAILABILITY, WORK, DRIVING)
    blocks = []
    current_block = {}
    rest_buffer = []
    last_dt = None

    for dt in dts:
        wt, m = day_bucket[dt]

        if last_dt is not None:
            gap_minutes = int((dt - last_dt).total_seconds() // 60)
            if gap_minutes > 1:
                if rest_buffer:
                    if len(rest_buffer) < rest_gap_threshold_minutes:
                        for rdt, rval in rest_buffer:
                            current_block[rdt] = rval
                    rest_buffer = []
                if current_block and any(v[0] in _REAL for v in current_block.values()):
                    blocks.append(current_block)
                current_block = {}

        last_dt = dt

        if wt in (REST, UNKNOWN):
            rest_buffer.append((dt, (wt, m)))

            if len(rest_buffer) >= rest_gap_threshold_minutes:
                if current_block and any(v[0] in _REAL for v in current_block.values()):
                    blocks.append(current_block)
                current_block = {}
            continue

        if rest_buffer:
            if len(rest_buffer) < rest_gap_threshold_minutes:
                for rdt, rval in rest_buffer:
                    current_block[rdt] = rval
            rest_buffer = []

        current_block[dt] = (wt, m)

    if rest_buffer:
        if len(rest_buffer) < rest_gap_threshold_minutes:
            for rdt, rval in rest_buffer:
                current_block[rdt] = rval

    if current_block and any(v[0] in _REAL for v in current_block.values()):
        blocks.append(current_block)

    return blocks
