"""Tiny helpers to compose synthetic activity timelines in tests."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from backend.compliance.models import ActivityType, NormalizedActivity


CET = ZoneInfo("Europe/Berlin")


def at(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=CET)


def act(
    start: datetime,
    minutes: int,
    type_: ActivityType,
    *,
    driver_id: str = "driver_1",
    vehicle_id: str | None = None,
    is_out_of_scope: bool = False,
) -> NormalizedActivity:
    return NormalizedActivity(
        driver_id=driver_id,
        type=type_,
        start=start,
        end=start + timedelta(minutes=minutes),
        vehicle_id=vehicle_id,
        is_out_of_scope=is_out_of_scope,
    )


def driving(start, minutes, **kw):
    return act(start, minutes, ActivityType.DRIVING, **kw)


def rest(start, minutes, **kw):
    return act(start, minutes, ActivityType.REST, **kw)


def break_(start, minutes, **kw):
    return act(start, minutes, ActivityType.BREAK, **kw)


def work(start, minutes, **kw):
    return act(start, minutes, ActivityType.WORK, **kw)


def availability(start, minutes, **kw):
    return act(start, minutes, ActivityType.AVAILABILITY, **kw)


def unknown(start, minutes, **kw):
    return act(start, minutes, ActivityType.UNKNOWN, **kw)


def chain(start: datetime, segments: list[tuple[ActivityType, int]],
          *, driver_id: str = "driver_1") -> list[NormalizedActivity]:
    """Build a contiguous timeline starting at ``start``.

    ``segments`` is a list of ``(type, minutes)`` pairs.
    """
    out: list[NormalizedActivity] = []
    cursor = start
    for type_, minutes in segments:
        out.append(act(cursor, minutes, type_, driver_id=driver_id))
        cursor = cursor + timedelta(minutes=minutes)
    return out
