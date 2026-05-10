"""Detect gaps and UNKNOWN windows in a driver's timeline."""

from __future__ import annotations

from typing import Iterable, Optional

from backend.compliance._time import sort_activities
from backend.compliance.models import (
    ActivityType,
    DataGap,
    NormalizedActivity,
)


def build_data_gaps(
    activities: Iterable[NormalizedActivity],
    *,
    period_start: Optional[object] = None,
    period_end: Optional[object] = None,
    min_gap_minutes: int = 1,
) -> list[DataGap]:
    """Return time windows with no coverage or marked UNKNOWN.

    Two cases:
    1. ``UNKNOWN`` activities — re-emitted as ``DataGap(kind="UNKNOWN")``.
    2. Wall-clock gaps between consecutive activities for the same driver,
       optionally clipped to ``[period_start, period_end)`` — emitted as
       ``DataGap(kind="MISSING")``.
    """
    sorted_acts = sort_activities(activities)
    out: list[DataGap] = []

    # Case 1: UNKNOWN activities are explicit gaps.
    for a in sorted_acts:
        if a.type != ActivityType.UNKNOWN:
            continue
        minutes = a.duration_minutes()
        if minutes >= min_gap_minutes:
            out.append(
                DataGap(
                    driver_id=a.driver_id,
                    start=a.start,
                    end=a.end,
                    minutes=minutes,
                    kind="UNKNOWN",
                )
            )

    # Case 2: between-activity gaps per driver.
    by_driver: dict[str, list[NormalizedActivity]] = {}
    for a in sorted_acts:
        by_driver.setdefault(a.driver_id, []).append(a)

    for driver_id, acts in by_driver.items():
        prev_end = None
        for a in acts:
            if prev_end is not None and a.start > prev_end:
                gap_start = max(prev_end, period_start) if period_start else prev_end
                gap_end = min(a.start, period_end) if period_end else a.start
                if gap_end > gap_start:
                    minutes = int((gap_end - gap_start).total_seconds() // 60)
                    if minutes >= min_gap_minutes:
                        out.append(
                            DataGap(
                                driver_id=driver_id,
                                start=gap_start,
                                end=gap_end,
                                minutes=minutes,
                                kind="MISSING",
                            )
                        )
            prev_end = max(prev_end, a.end) if prev_end else a.end

    out.sort(key=lambda g: (g.driver_id, g.start))
    return out
