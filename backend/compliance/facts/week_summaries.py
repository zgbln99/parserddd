"""Daily, weekly and rolling-fortnightly driving summaries."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

from backend.compliance._time import (
    day_bounds_local,
    overlap_minutes,
    sort_activities,
    week_bounds,
)
from backend.compliance.models import (
    ActivityType,
    DailyDrivingSummary,
    FortnightlyDrivingSummary,
    NormalizedActivity,
    WeeklyDrivingSummary,
)


def _driving_minutes_in(
    activities: Iterable[NormalizedActivity],
    start, end,
) -> int:
    total = 0
    for a in activities:
        if a.type != ActivityType.DRIVING or a.is_out_of_scope:
            continue
        total += overlap_minutes(a.start, a.end, start, end)
    return total


def build_daily_driving_summaries(
    activities: Iterable[NormalizedActivity],
    *,
    timezone: str = "Europe/Berlin",
    daily_normal_min: int = 540,
) -> list[DailyDrivingSummary]:
    tz = ZoneInfo(timezone)
    sorted_acts = sort_activities(activities)
    if not sorted_acts:
        return []

    seen: dict[tuple[str, int, int, int], tuple] = {}
    for a in sorted_acts:
        if a.type != ActivityType.DRIVING or a.is_out_of_scope:
            # Daily-driving summaries should only be created for days that
            # actually contain driving — otherwise a long REST straddling
            # midnight would create a phantom 0-minute day.
            continue
        cur = a.start
        while cur < a.end:
            day_start, day_end = day_bounds_local(cur, tz)
            key = (a.driver_id, day_start.year, day_start.month, day_start.day)
            seen[key] = (a.driver_id, day_start, day_end)
            cur = day_end

    out: list[DailyDrivingSummary] = []
    for _, (driver_id, day_start, day_end) in seen.items():
        same_driver = [a for a in sorted_acts if a.driver_id == driver_id]
        minutes = _driving_minutes_in(same_driver, day_start, day_end)
        if minutes <= 0:
            continue
        out.append(
            DailyDrivingSummary(
                driver_id=driver_id,
                period_start=day_start,
                period_end=day_end,
                driving_minutes=minutes,
                is_extended_to_10h=minutes > daily_normal_min,
            )
        )

    out.sort(key=lambda s: (s.driver_id, s.period_start))
    return out


def build_weekly_driving_summaries(
    activities: Iterable[NormalizedActivity],
    daily_summaries: Iterable[DailyDrivingSummary],
    *,
    timezone: str = "Europe/Berlin",
) -> list[WeeklyDrivingSummary]:
    tz = ZoneInfo(timezone)
    sorted_acts = sort_activities(activities)
    # Only DRIVING activities seed weekly buckets — otherwise a REST
    # straddling Sunday/Monday would create an empty week 2 with phantom
    # driving totals. Same fix as the daily-summary builder.
    bucket_bounds: dict[tuple[str, int, int, int], tuple] = {}

    for a in sorted_acts:
        if a.type != ActivityType.DRIVING or a.is_out_of_scope:
            continue
        cur = a.start
        while cur < a.end:
            week_start, week_end = week_bounds(cur, tz)
            key = (a.driver_id, week_start.year, week_start.month, week_start.day)
            bucket_bounds[key] = (a.driver_id, week_start, week_end)
            cur = week_end

    daily_by_driver: dict[str, list[DailyDrivingSummary]] = defaultdict(list)
    for s in daily_summaries:
        daily_by_driver[s.driver_id].append(s)

    out: list[WeeklyDrivingSummary] = []
    for key, (driver_id, week_start, week_end) in bucket_bounds.items():
        same_driver = [a for a in sorted_acts if a.driver_id == driver_id]
        minutes = _driving_minutes_in(same_driver, week_start, week_end)
        daily = tuple(
            s for s in daily_by_driver.get(driver_id, [])
            if week_start <= s.period_start < week_end
        )
        out.append(
            WeeklyDrivingSummary(
                driver_id=driver_id,
                week_start=week_start,
                week_end=week_end,
                driving_minutes=minutes,
                daily_summaries=daily,
                extended_days_count=sum(1 for s in daily if s.is_extended_to_10h),
            )
        )

    out.sort(key=lambda s: (s.driver_id, s.week_start))
    return out


def build_fortnightly_driving_summaries(
    weekly: Iterable[WeeklyDrivingSummary],
) -> list[FortnightlyDrivingSummary]:
    """Pair each week with the immediately previous week of the same driver.

    Sliding pair: weeks (n-1, n). Skips the first week per driver because
    there's no preceding week in scope.
    """
    weekly_sorted = sorted(weekly, key=lambda w: (w.driver_id, w.week_start))
    out: list[FortnightlyDrivingSummary] = []

    by_driver: dict[str, list[WeeklyDrivingSummary]] = defaultdict(list)
    for w in weekly_sorted:
        by_driver[w.driver_id].append(w)

    for driver_id, weeks in by_driver.items():
        for i in range(1, len(weeks)):
            prev, cur = weeks[i - 1], weeks[i]
            # Only pair *consecutive* weeks (no missing week between).
            if cur.week_start != prev.week_end:
                continue
            out.append(
                FortnightlyDrivingSummary(
                    driver_id=driver_id,
                    week_start=prev.week_start,
                    week_end=cur.week_end,
                    driving_minutes=prev.driving_minutes + cur.driving_minutes,
                )
            )
    return out
