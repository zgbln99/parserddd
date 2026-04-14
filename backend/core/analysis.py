"""
Main card analysis — analyze_card().

This is the most critical function in the system. It combines timeline
building, shift detection, night hour calculation, and per-CET-day
calendar metrics into a single comprehensive result dict.

DO NOT simplify or change the algorithms — they must match GloboFleet
behavior exactly (including UTC/CET handling, Globofleet strict mode,
and night hour 25%/40% rules).
"""

import json
import logging
import os
from datetime import datetime, timedelta

from .constants import (
    REST, AVAILABILITY, WORK, DRIVING, UNKNOWN,
    STRICT_GLOBOFLEET_MODE, ACTIVITY_NAMES,
    _is_break_like_for_reporting,
)
from .utils import _to_cet, parse_date_safe, minutes_to_hm, minutes_to_decimal
from .extractors import (
    get_driver_info, get_activity_records, get_vehicle_records,
    get_card_places, get_card_events,
)
from .timeline import build_timeline
from .shifts import (
    detect_shifts, calculate_shift_night_hours,
    iter_tachograph_minutes, count_bucket_minutes_between,
    count_minutes_for_interval_from_buckets,
)
from .constants import CET

logger = logging.getLogger('ddd-reader')


def analyze_card(data, night_start_hour=None, config_loader=None, night_40_check_midnight=True, pause_cap_enabled=False, weekend_diet=False, night_includes_breaks=False):
    """Analyze a parsed DDD card: shifts, calendar days, night hours, diets.

    Args:
        data: Parsed DDD data dict (from parse_ddd_auto or similar).
        night_start_hour: Override for night start hour (default: from config or 22).
        config_loader: Callable returning config dict (for night_start_hour default).
        night_40_check_midnight: If True (default), 00:00-04:00 is 40% only when shift
            started before midnight. If False, always 40%.
        pause_cap_enabled: If True, shifts with driving < 4.5h get max 45min break,
            excess break is counted as Bereitschaft (AVAILABILITY).
    """
    if night_start_hour is None:
        if config_loader:
            cfg = config_loader()
            night_start_hour = int(cfg.get('night_start_hour', 22))
        else:
            night_start_hour = 22

    driver_info = get_driver_info(data)
    records = get_activity_records(data)
    vehicles = get_vehicle_records(data)
    places = get_card_places(data)
    card_events = get_card_events(data)
    timeline = build_timeline(records)
    shifts = detect_shifts(timeline)

    # Helper: UTC-aware datetime -> CET string for display only
    def _to_cet_str(dt):
        return _to_cet(dt).strftime('%Y-%m-%d %H:%M')

    def _build_segments(bucket, target_wt):
        dts = sorted(dt for dt, (wt, _m) in bucket.items() if wt == target_wt)
        if not dts:
            return []
        segments = []
        seg_start = dts[0]
        prev_dt = dts[0]
        for dt in dts[1:]:
            if dt != prev_dt + timedelta(minutes=1):
                segments.append((seg_start, prev_dt + timedelta(minutes=1)))
                seg_start = dt
            prev_dt = dt
        segments.append((seg_start, prev_dt + timedelta(minutes=1)))
        return segments

    _REAL_WORK = (AVAILABILITY, WORK, DRIVING)

    # Collect all manual entries and detect suspicious ones
    wt_names = {AVAILABILITY: 'Bereitschaft', WORK: 'Arbeit', DRIVING: 'Lenken'}
    manual_entries = []
    manual_errors = []
    for s, e, wt, m in timeline:
        if not m or wt in (REST, UNKNOWN):
            continue
        dur_min = int((e - s).total_seconds() / 60)
        if dur_min < 1:
            continue
        entry = {
            'start': _to_cet_str(s),
            'end': _to_cet_str(e),
            'duration_minutes': dur_min,
            'declared_type': wt_names.get(wt, str(wt)),
        }
        manual_entries.append(entry)
        if dur_min >= 30:
            s_cet = _to_cet(s)
            e_cet = _to_cet(e)
            h_start = s_cet.hour
            h_end = e_cet.hour if e_cet.date() == s_cet.date() else 24
            is_overnight = h_start >= 20 or h_end <= 7 or (e - s).total_seconds() > 10 * 3600
            if is_overnight or dur_min > 600:
                manual_errors.append(entry)

    shift_details = []
    seen_shifts = set()
    total_work = total_driving = total_break = total_avail = 0
    total_n25 = total_n40 = 0
    total_manual = 0
    diet_count = 0

    priority = {UNKNOWN: 0, REST: 1, AVAILABILITY: 2, WORK: 3, DRIVING: 4}

    # --- Calendar-day metrics (CET) ---
    # Independent of shift splitting: attribute each minute to its CET calendar day.
    # This matches GloboFleet's per-day reporting.
    _cd = {}
    _REAL_WT = (WORK, DRIVING, AVAILABILITY)
    try:
        for dt, wt, card_out in iter_tachograph_minutes(timeline):
            dt_cet = _to_cet(dt)
            cet_date = dt_cet.strftime('%Y-%m-%d')
            if cet_date not in _cd:
                _cd[cet_date] = {
                    'work': 0, 'driving': 0, 'work_only': 0, 'avail': 0,
                    'break': 0, 'manual': 0, 'n25': 0, 'n40': 0,
                    'first_work': None, 'last_work': None,
                }
            cd = _cd[cet_date]

            if wt in _REAL_WT:
                cd['work'] += 1
                if cd['first_work'] is None:
                    cd['first_work'] = dt_cet
                cd['last_work'] = dt_cet
                if card_out:
                    cd['manual'] += 1
                # Night hours
                hour = dt_cet.hour
                if night_start_hour <= hour <= 23:
                    cd['n25'] += 1
                elif 0 <= hour < 4:
                    cd['n40'] += 1
                elif 4 <= hour < 6:
                    cd['n25'] += 1
            if wt == DRIVING:
                cd['driving'] += 1
            elif wt == WORK:
                cd['work_only'] += 1
            elif wt == AVAILABILITY:
                cd['avail'] += 1
    except Exception as exc:
        logger.warning('calendar_days iteration error: %s', exc)

    # Build calendar_days dict
    weekday_names = ['Pn', 'Wt', 'Sr', 'Cz', 'Pt', 'So', 'Nd']
    calendar_days = {}
    for d in sorted(_cd.keys()):
        try:
            cd = _cd[d]
            if cd['work'] == 0 and cd['driving'] == 0:
                continue
            w = cd['work']
            first = cd['first_work']
            last = cd['last_work']
            duration = 0
            if first and last:
                duration = int((last - first).total_seconds() / 60) + 1
            # Break = duration minus actual work
            brk = max(0, duration - w)
            cd['break'] = brk
            parsed_date = parse_date_safe(d)
            wd_idx = parsed_date.weekday() if parsed_date else 0
            is_weekday = wd_idx < 5
            has_diet = duration >= 480 and (is_weekday or weekend_diet)

            calendar_days[d] = {
                'date': d,
                'weekday': weekday_names[wd_idx] if parsed_date else '',
                'shift_start': first.strftime('%Y-%m-%d %H:%M') if first else '',
                'shift_end': (last + timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M') if last else '',
                'duration_minutes': duration,
                'duration_hm': minutes_to_hm(duration),
                'work_minutes': w,
                'work_hm': minutes_to_hm(w),
                'work_decimal': round(w / 60, 2),
                'driving_minutes': cd['driving'],
                'driving_hm': minutes_to_hm(cd['driving']),
                'work_only_minutes': cd['work_only'],
                'work_only_hm': minutes_to_hm(cd['work_only']),
                'avail_minutes': cd['avail'],
                'avail_hm': minutes_to_hm(cd['avail']),
                'break_minutes': cd['break'],
                'break_hm': minutes_to_hm(cd['break']),
                'night_25_minutes': cd['n25'],
                'night_25_hm': minutes_to_hm(cd['n25']),
                'night_40_minutes': cd['n40'],
                'night_40_hm': minutes_to_hm(cd['n40']),
                'manual_minutes': cd['manual'],
                'manual_hm': minutes_to_hm(cd['manual']),
                'has_diet': has_diet,
            }
        except Exception as exc:
            logger.warning('calendar_days error for %s: %s', d, exc)

    for shift_intervals in shifts:
        if not shift_intervals:
            continue

        # Build minute buckets for this shift
        minute_buckets = {}
        for dt, wt, m in iter_tachograph_minutes(shift_intervals):
            if dt not in minute_buckets or priority[wt] > priority[minute_buckets[dt][0]]:
                minute_buckets[dt] = (wt, m)

        # Shift span from real work minutes (WORK/DRIVING/AVAIL).
        # Overnight periods are REST/UNKNOWN after the fill fix, so they're
        # naturally excluded without needing a manual flag filter.
        work_dts = sorted(
            dt for dt, (wt, _m) in minute_buckets.items()
            if wt in _REAL_WORK
        )
        if not work_dts:
            continue
        shift_start = work_dts[0]
        shift_end = work_dts[-1] + timedelta(minutes=1)
        shift_date = _to_cet(shift_start).strftime('%Y-%m-%d')
        # grid_date = shift start date — diet/allowance depends on when the
        # shift began (e.g. Sunday shift = no diet, even if it runs into Monday).
        grid_date = shift_date

        shift_key = (shift_start, shift_end)
        if shift_key in seen_shifts:
            continue
        seen_shifts.add(shift_key)

        # Totals from minutes within the shift span
        span_buckets = {
            dt: v for dt, v in minute_buckets.items()
            if shift_start <= dt < shift_end
        }

        if STRICT_GLOBOFLEET_MODE:
            break_minutes = sum(
                1 for wt, _m in span_buckets.values()
                if _is_break_like_for_reporting(wt)
            )
        else:
            break_minutes = sum(
                1 for wt, _m in span_buckets.values()
                if wt in (REST, UNKNOWN)
            )
        avail_minutes = sum(1 for wt, _m in span_buckets.values() if wt == AVAILABILITY)
        work_only_minutes = sum(1 for wt, _m in span_buckets.values() if wt == WORK)
        driving_minutes = sum(1 for wt, _m in span_buckets.values() if wt == DRIVING)
        unknown_minutes = sum(1 for wt, _m in span_buckets.values() if wt == UNKNOWN)
        manual_minutes = sum(
            1 for _dt, (wt, m) in span_buckets.items()
            if m and wt in _REAL_WORK
        )
        work_minutes = work_only_minutes + driving_minutes + avail_minutes
        duration_minutes = count_bucket_minutes_between(shift_start, shift_end)
        cet_start = _to_cet(shift_start)

        # Pause cap: excess break (>45min) counts toward night premiums but NOT work time.
        # Build separate buckets for night calculation with excess REST→AVAILABILITY.
        if pause_cap_enabled and break_minutes > 45:
            night_buckets = dict(span_buckets)
            rest_dts = sorted(
                dt for dt, (wt, _m) in night_buckets.items()
                if _is_break_like_for_reporting(wt)
            ) if STRICT_GLOBOFLEET_MODE else sorted(
                dt for dt, (wt, _m) in night_buckets.items()
                if wt in (REST, UNKNOWN)
            )
            for dt in rest_dts[45:]:
                wt_old, m_old = night_buckets[dt]
                night_buckets[dt] = (AVAILABILITY, m_old)
            night_25, night_40 = calculate_shift_night_hours(night_buckets, shift_start, night_start_hour, night_40_check_midnight, night_includes_breaks)
        else:
            night_25, night_40 = calculate_shift_night_hours(span_buckets, shift_start, night_start_hour, night_40_check_midnight, night_includes_breaks)

        total_work += work_minutes
        total_driving += driving_minutes
        total_break += break_minutes
        total_avail += avail_minutes
        total_n25 += night_25
        total_n40 += night_40
        total_manual += manual_minutes
        is_weekday = cet_start.weekday() < 5
        has_diet = duration_minutes >= 8 * 60 and (is_weekday or weekend_diet)
        if has_diet:
            diet_count += 1

        shift_start_date = shift_start.date()
        shift_end_date = shift_end.date()
        day_plates = []
        for v in vehicles:
            v_start = parse_date_safe(v.get('first_use', ''))
            v_end = parse_date_safe(v.get('last_use', ''))
            if v_start and v_end and v_start <= shift_end_date and v_end >= shift_start_date:
                day_plates.append(v['plate'])
        unique_plates = list(dict.fromkeys(day_plates))

        driving_segments = [{
            'start': _to_cet_str(seg_start),
            'end': _to_cet_str(seg_end),
            'duration_minutes': count_minutes_for_interval_from_buckets(
                seg_start, seg_end, DRIVING, span_buckets
            ),
        } for seg_start, seg_end in _build_segments(span_buckets, DRIVING)]
        break_segments = [{
            'start': _to_cet_str(seg_start),
            'end': _to_cet_str(seg_end),
            'duration_minutes': count_minutes_for_interval_from_buckets(
                seg_start, seg_end, REST, span_buckets
            ),
        } for seg_start, seg_end in _build_segments(span_buckets, REST)]

        # Full activity timeline for Arbeitszeitbericht
        activity_timeline = []
        sorted_dts = sorted(span_buckets.keys())
        if sorted_dts:
            seg_wt = span_buckets[sorted_dts[0]][0]
            seg_start_dt = sorted_dts[0]
            prev_dt = sorted_dts[0]
            for dt in sorted_dts[1:]:
                wt_cur = span_buckets[dt][0]
                gap = int((dt - prev_dt).total_seconds()) // 60
                if wt_cur != seg_wt or gap > 1:
                    dur = int((prev_dt - seg_start_dt).total_seconds()) // 60 + 1
                    if dur > 0:
                        activity_timeline.append({
                            'start': _to_cet_str(seg_start_dt),
                            'end': _to_cet_str(prev_dt + timedelta(minutes=1)),
                            'duration_minutes': dur,
                            'type': ACTIVITY_NAMES.get(seg_wt, 'UNKNOWN'),
                        })
                    seg_wt = wt_cur
                    seg_start_dt = dt
                prev_dt = dt
            dur = int((prev_dt - seg_start_dt).total_seconds()) // 60 + 1
            if dur > 0:
                activity_timeline.append({
                    'start': _to_cet_str(seg_start_dt),
                    'end': _to_cet_str(prev_dt + timedelta(minutes=1)),
                    'duration_minutes': dur,
                    'type': ACTIVITY_NAMES.get(seg_wt, 'UNKNOWN'),
                })

        weekday_names_shift = ['Pn', 'Wt', 'Sr', 'Cz', 'Pt', 'So', 'Nd']
        shift_details.append({
            'shift_start': _to_cet_str(shift_start),
            'shift_end': _to_cet_str(shift_end),
            'shift_date': shift_date,
            'grid_date': grid_date,
            'weekday': weekday_names_shift[cet_start.weekday()],
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
            'unknown_minutes': unknown_minutes,
            'unknown_hm': minutes_to_hm(unknown_minutes),
            'night_25_minutes': night_25,
            'night_25_hm': minutes_to_hm(night_25),
            'night_40_minutes': night_40,
            'night_40_hm': minutes_to_hm(night_40),
            'has_diet': has_diet,
            'vehicles': unique_plates,
            'manual_minutes': manual_minutes,
            'manual_hm': minutes_to_hm(manual_minutes),
            'driving_segments': driving_segments,
            'break_segments': break_segments,
            'activity_timeline': activity_timeline,
            'manual_errors': manual_errors,
        })

    # Summary: work/driving/break/avail from calendar_days, night hours from shifts
    # (shift-level night calculation respects night_40_check_midnight toggle)
    cd_total_work = sum(cd.get('work_minutes', 0) for cd in calendar_days.values())
    cd_total_driving = sum(cd.get('driving_minutes', 0) for cd in calendar_days.values())
    cd_total_break = sum(cd.get('break_minutes', 0) for cd in calendar_days.values())
    cd_total_avail = sum(cd.get('avail_minutes', 0) for cd in calendar_days.values())
    cd_total_manual = sum(cd.get('manual_minutes', 0) for cd in calendar_days.values())
    cd_diet_count = sum(1 for cd in calendar_days.values() if cd.get('has_diet'))
    total_night = total_n25 + total_n40

    return {
        'driver_info': driver_info,
        'vehicles': vehicles,
        'summary': {
            'total_work_hm': minutes_to_hm(cd_total_work),
            'total_work_decimal': minutes_to_decimal(cd_total_work),
            'total_work_minutes': cd_total_work,
            'total_driving_hm': minutes_to_hm(cd_total_driving),
            'total_driving_minutes': cd_total_driving,
            'total_break_hm': minutes_to_hm(cd_total_break),
            'total_break_minutes': cd_total_break,
            'total_avail_hm': minutes_to_hm(cd_total_avail),
            'total_avail_minutes': cd_total_avail,
            'night_25_hm': minutes_to_hm(total_n25),
            'night_25_decimal': minutes_to_decimal(total_n25),
            'night_25_minutes': total_n25,
            'night_40_hm': minutes_to_hm(total_n40),
            'night_40_decimal': minutes_to_decimal(total_n40),
            'night_40_minutes': total_n40,
            'total_night_hm': minutes_to_hm(total_night),
            'total_night_decimal': minutes_to_decimal(total_night),
            'total_night_minutes': total_night,
            'diet_count': cd_diet_count,
            'total_shifts': len(shift_details),
            'total_manual_hm': minutes_to_hm(cd_total_manual),
            'total_manual_minutes': cd_total_manual,
        },
        'shift_details': shift_details,
        'calendar_days': calendar_days,
        'manual_entries': manual_entries,
        'card_places': places,
        'card_events': card_events,
        'night_start_hour': night_start_hour,
    }
