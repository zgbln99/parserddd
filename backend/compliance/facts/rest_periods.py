"""Rest-period extraction.

A rest period is a maximal run of contiguous REST/BREAK activity. We do not
classify it as daily vs. weekly here — that decision belongs to the rules,
which look at duration and surrounding context.
"""

from __future__ import annotations

from typing import Iterable

from backend.compliance._time import sort_activities
from backend.compliance.models import (
    ActivityType,
    NormalizedActivity,
    RestPeriod,
)


_REST_LIKE = (ActivityType.REST, ActivityType.BREAK)


def build_rest_periods(
    activities: Iterable[NormalizedActivity],
    *,
    min_minutes: int = 1,
) -> list[RestPeriod]:
    """Coalesce neighbouring REST/BREAK activities into one period each.

    Two REST activities are merged when they are contiguous (``end == start``
    of the next). Any non-rest activity (including AVAILABILITY/UNKNOWN)
    breaks the run.
    """
    sorted_acts = sort_activities(activities)
    periods: list[RestPeriod] = []

    cur_start = None
    cur_end = None
    cur_driver = None

    for act in sorted_acts:
        if act.type in _REST_LIKE:
            if cur_start is None:
                cur_start, cur_end, cur_driver = act.start, act.end, act.driver_id
            elif act.start == cur_end and act.driver_id == cur_driver:
                cur_end = act.end
            else:
                # gap or driver switch -> close previous, start new
                _emit(periods, cur_driver, cur_start, cur_end, min_minutes)
                cur_start, cur_end, cur_driver = act.start, act.end, act.driver_id
        else:
            if cur_start is not None:
                _emit(periods, cur_driver, cur_start, cur_end, min_minutes)
                cur_start = cur_end = cur_driver = None

    if cur_start is not None:
        _emit(periods, cur_driver, cur_start, cur_end, min_minutes)
    return periods


def _emit(out: list[RestPeriod], driver_id, start, end, min_minutes: int):
    minutes = int((end - start).total_seconds() // 60)
    if minutes >= min_minutes:
        out.append(
            RestPeriod(
                driver_id=driver_id, start=start, end=end, minutes=minutes
            )
        )
