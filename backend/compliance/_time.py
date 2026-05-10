"""Small time helpers shared by the engine.

Half-open interval semantics throughout: ``[start, end)``.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable
from zoneinfo import ZoneInfo


def minutes_between(a: datetime, b: datetime) -> int:
    """Whole minutes from ``a`` to ``b``. Negative if ``b < a``."""
    return int((b - a).total_seconds() // 60)


def overlap_minutes(a_start: datetime, a_end: datetime,
                    b_start: datetime, b_end: datetime) -> int:
    """Length of the intersection ``[a] ∩ [b]`` in minutes."""
    lo = max(a_start, b_start)
    hi = min(a_end, b_end)
    if hi <= lo:
        return 0
    return int((hi - lo).total_seconds() // 60)


def sort_activities(activities: Iterable) -> list:
    """Sort by start, then end. Stable on equal keys."""
    return sorted(activities, key=lambda a: (a.start, a.end))


def week_bounds(d: datetime, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """Transport week: Monday 00:00 .. next Monday 00:00, in ``tz``.

    Returned timestamps are timezone-aware in ``tz``. The right endpoint is
    exclusive.
    """
    local = d.astimezone(tz)
    # Monday is weekday() == 0
    monday = local - timedelta(days=local.weekday())
    monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    next_monday = monday + timedelta(days=7)
    return monday, next_monday


def day_bounds_local(d: datetime, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """Calendar day in ``tz``."""
    local = d.astimezone(tz)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)
