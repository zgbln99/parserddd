"""Build a driver's "day" framing.

EU 561 thinks of a day as the span between two daily rests, not a calendar
day. Without the surrounding context the engine can't always frame days
that way (the period boundary is ambiguous when the previous/next rest is
outside the analysis window). We therefore offer a *fallback* mode that
buckets activities by calendar day in the chosen timezone and sets
``is_calendar_day_fallback=True`` on the resulting period.

TODO: Replace the calendar-day fallback with a true rest-to-rest framing
once the parser hands over full surrounding context. The current behaviour
is good enough for daily-driving rules but slightly under-counts drivers
whose duty crosses midnight.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

from backend.compliance._time import day_bounds_local, sort_activities
from backend.compliance.models import (
    DailyWorkPeriod,
    NormalizedActivity,
)


def build_daily_work_periods(
    activities: Iterable[NormalizedActivity],
    *,
    timezone: str = "Europe/Berlin",
) -> list[DailyWorkPeriod]:
    tz = ZoneInfo(timezone)
    sorted_acts = sort_activities(activities)
    by_day: dict[tuple[str, int, int, int], list[NormalizedActivity]] = defaultdict(list)

    for act in sorted_acts:
        # An activity spanning multiple local days is split for bucketing.
        cur = act.start
        while cur < act.end:
            day_start, day_end = day_bounds_local(cur, tz)
            slice_end = min(act.end, day_end)
            key = (act.driver_id, day_start.year, day_start.month, day_start.day)
            # We keep the *original* activity object; per-day slicing happens
            # only for routing into the right bucket. This avoids creating
            # synthetic activities that lie about their boundaries.
            if not by_day[key] or by_day[key][-1] is not act:
                by_day[key].append(act)
            cur = slice_end + timedelta(microseconds=0) if slice_end == cur else slice_end

    periods: list[DailyWorkPeriod] = []
    for key, acts in by_day.items():
        driver_id, y, m, d = key
        # Use clipped local bounds for the period, anchored to the day.
        first = min(a.start for a in acts)
        last = max(a.end for a in acts)
        day_start, day_end = day_bounds_local(first, tz)
        periods.append(
            DailyWorkPeriod(
                driver_id=driver_id,
                start=max(day_start, first),
                end=min(day_end, last),
                activities=tuple(acts),
                is_calendar_day_fallback=True,
            )
        )

    periods.sort(key=lambda p: (p.driver_id, p.start))
    return periods
