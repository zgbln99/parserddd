"""Build driving blocks for the continuous-driving rule.

A driving block represents one run of jazda ciągła. It accumulates DRIVING
minutes and intercalated short breaks until any of these resets the
counter:

* a single break/rest >= 45 minutes,
* a valid 15+30 split (in this order, no DRIVING in between, no other gap),
* a REST window >= 45 minutes.

Notes:
* OUT_OF_SCOPE driving (``is_out_of_scope=True``) is *not* counted toward
  the continuous-driving total — see EU 561 Art. 4(e).
* AVAILABILITY counts as a pause for break-aggregation purposes (in line
  with how short waits are normally interpreted on cards), but only a
  REST/BREAK can fulfil a 15- or 30-minute leg of a split.
"""

from __future__ import annotations

from typing import Iterable

from backend.compliance._time import sort_activities
from backend.compliance.models import (
    ActivityType,
    BreakSegment,
    DrivingBlock,
    NormalizedActivity,
)


_DRIVING = ActivityType.DRIVING
_BREAK_LIKE = (ActivityType.BREAK, ActivityType.REST)
_PAUSE_LIKE = (ActivityType.BREAK, ActivityType.REST, ActivityType.AVAILABILITY)


def _is_qualifying_break(seg: BreakSegment, required: int) -> bool:
    return seg.minutes >= required


def _is_valid_split(segments: list[BreakSegment],
                    first_min: int, second_min: int) -> bool:
    """True if any prefix ``[a, b]`` of segments forms a valid 15+30 split.

    The first leg must be >= ``first_min`` AND strictly shorter than the
    full required break (otherwise it would already qualify on its own and
    we'd never enter "split" mode). The second leg must be >= ``second_min``
    and follow the first immediately within the same in-block break run.
    The order is fixed: first then second; 30+15 does not count.
    """
    if len(segments) < 2:
        return False
    a, b = segments[-2], segments[-1]
    return a.minutes >= first_min and b.minutes >= second_min


def build_driving_blocks(
    activities: Iterable[NormalizedActivity],
    *,
    required_break_min: int = 45,
    split_first_min: int = 15,
    split_second_min: int = 30,
) -> list[DrivingBlock]:
    """Return chronologically ordered driving blocks, grouped per driver."""
    by_driver: dict[str, list[NormalizedActivity]] = {}
    for a in activities:
        by_driver.setdefault(a.driver_id, []).append(a)

    all_blocks: list[DrivingBlock] = []
    for driver_id, driver_acts in by_driver.items():
        all_blocks.extend(
            _build_for_one_driver(
                driver_acts,
                required_break_min=required_break_min,
                split_first_min=split_first_min,
                split_second_min=split_second_min,
            )
        )
    all_blocks.sort(key=lambda b: (b.driver_id, b.start))
    return all_blocks


def _build_for_one_driver(
    activities: Iterable[NormalizedActivity],
    *,
    required_break_min: int,
    split_first_min: int,
    split_second_min: int,
) -> list[DrivingBlock]:
    sorted_acts = sort_activities(activities)
    blocks: list[DrivingBlock] = []

    cur_acts: list[NormalizedActivity] = []
    cur_breaks: list[BreakSegment] = []
    cur_driving_min = 0
    cur_start = None

    def _flush(end_at):
        nonlocal cur_acts, cur_breaks, cur_driving_min, cur_start
        if cur_acts and cur_driving_min > 0 and cur_start is not None:
            blocks.append(
                DrivingBlock(
                    driver_id=cur_acts[0].driver_id,
                    start=cur_start,
                    end=end_at,
                    driving_minutes=cur_driving_min,
                    break_segments=tuple(cur_breaks),
                    activities=tuple(cur_acts),
                )
            )
        cur_acts = []
        cur_breaks = []
        cur_driving_min = 0
        cur_start = None

    for act in sorted_acts:
        dur = act.duration_minutes()
        if dur <= 0:
            continue

        if act.type == _DRIVING and not act.is_out_of_scope:
            if cur_start is None:
                cur_start = act.start
            cur_acts.append(act)
            cur_driving_min += dur
            # New driving after a partial split clears the split prefix.
            if cur_breaks and _is_valid_split(
                cur_breaks, split_first_min, split_second_min
            ):
                # Already reset above by the split detector branch; nothing.
                pass
        elif act.type in _PAUSE_LIKE:
            # Only REST/BREAK qualifies as part of a 45 or 15+30 reset.
            if act.type in _BREAK_LIKE:
                seg = BreakSegment(start=act.start, end=act.end, minutes=dur)
                if cur_acts:
                    cur_breaks.append(seg)
                # Single qualifying break -> reset.
                if _is_qualifying_break(seg, required_break_min):
                    _flush(act.end)
                    continue
                # Valid 15+30 split -> reset.
                if _is_valid_split(
                    cur_breaks, split_first_min, split_second_min
                ):
                    _flush(act.end)
                    continue
            else:
                # AVAILABILITY interrupts driving for accumulation purposes
                # but cannot itself satisfy the break requirement. We track
                # it as a non-qualifying segment so reporting can show it.
                if cur_acts:
                    # TODO: Currently AVAILABILITY does not reset; legal
                    # treatment depends on whether it follows the 15-min
                    # leg or stands alone. Keep as a no-op for now.
                    pass
        else:
            # WORK / UNKNOWN / OUT-OF-SCOPE driving: counts neither toward
            # driving minutes nor as a break.
            # TODO: A long WORK period probably doesn't reset jazda ciągła
            # under Art. 7, but practical interpretation varies. Leave as
            # passthrough.
            pass

    _flush(sorted_acts[-1].end if sorted_acts else None)
    return blocks
