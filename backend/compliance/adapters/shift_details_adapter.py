"""Adapter: ``analyze_card``-shaped result -> NormalizedActivity[].

The frontend already has the *analysed* shape (``AnalysisResult``) — not
the raw parsed-DDD dict and not a per-minute timeline. The structure
carries one ``ShiftDetail`` per shift, with ``driving_segments`` and
``break_segments`` plus aggregates for work / availability / breaks.

To run compliance from the UI without re-parsing, we adapt this analysed
shape into a coarse-grained timeline:

* Each ``driving_segments[]`` entry becomes a DRIVING activity.
* Each ``break_segments[]`` entry becomes a BREAK activity.
* The wall-clock gap from the previous shift's end to the current
  shift's start, if any, becomes a REST activity.

This is intentionally coarse — it doesn't try to reconstruct individual
WORK / AVAILABILITY slices because the analysis layer only exposes their
totals, not their start/end. For the rules we care about
(continuous-driving, daily/weekly/fortnightly driving, daily/weekly
rest, data-gap warnings) the coarse view is sufficient. Other rules
that need WORK/AVAILABILITY granularity will simply not fire — that's
preferable to inventing fake activities.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Mapping, Optional
from zoneinfo import ZoneInfo

_FALLBACK_TZ = ZoneInfo("Europe/Berlin")

from backend.compliance.models import (
    ActivitySource,
    ActivityType,
    NormalizedActivity,
)


def looks_like_analysis_result(parser_analysis: Mapping[str, Any]) -> bool:
    """True if the input matches the ``analyze_card`` output shape."""
    return isinstance(parser_analysis.get("shift_details"), list)


def from_shift_details(
    parser_analysis: Mapping[str, Any],
    *,
    source: ActivitySource = ActivitySource.DDD,
) -> list[NormalizedActivity]:
    """Adapt ``analyze_card`` output to NormalizedActivity[]."""
    driver_info = parser_analysis.get("driver_info") or {}
    vehicles = parser_analysis.get("vehicles") or []
    driver_id = _driver_id(driver_info)
    vehicle_id = _vehicle_id(vehicles)

    shifts = parser_analysis.get("shift_details") or []
    if not isinstance(shifts, list):
        return []

    # Order shifts by start; ``shift_start`` is an ISO-like string.
    ordered = sorted(
        (s for s in shifts if isinstance(s, Mapping)),
        key=lambda s: _parse_dt(s.get("shift_start")) or datetime.max,
    )

    out: list[NormalizedActivity] = []
    prev_end: Optional[datetime] = None

    for shift in ordered:
        shift_start = _parse_dt(shift.get("shift_start"))
        shift_end = _parse_dt(shift.get("shift_end"))

        # REST between consecutive shifts.
        if prev_end is not None and shift_start is not None and shift_start > prev_end:
            out.append(
                NormalizedActivity(
                    driver_id=driver_id,
                    vehicle_id=vehicle_id,
                    type=ActivityType.REST,
                    start=prev_end,
                    end=shift_start,
                    source=source,
                )
            )

        # DRIVING and BREAK segments inside the shift.
        for seg in shift.get("driving_segments") or []:
            _append_segment(
                out, seg, ActivityType.DRIVING,
                driver_id=driver_id, vehicle_id=vehicle_id, source=source,
            )
        for seg in shift.get("break_segments") or []:
            _append_segment(
                out, seg, ActivityType.BREAK,
                driver_id=driver_id, vehicle_id=vehicle_id, source=source,
            )

        if shift_end is not None:
            prev_end = shift_end if prev_end is None or shift_end > prev_end else prev_end

    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _append_segment(
    out: list[NormalizedActivity],
    seg: Any,
    type_: ActivityType,
    *,
    driver_id: str,
    vehicle_id: Optional[str],
    source: ActivitySource,
) -> None:
    if not isinstance(seg, Mapping):
        return
    start = _parse_dt(seg.get("start"))
    end = _parse_dt(seg.get("end"))
    if start is None or end is None or end <= start:
        return
    out.append(
        NormalizedActivity(
            driver_id=driver_id,
            vehicle_id=vehicle_id,
            type=type_,
            start=start,
            end=end,
            source=source,
        )
    )


def _parse_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=_FALLBACK_TZ)
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    # ``analyze_card`` formats with ``_to_cet_str`` -> "%Y-%m-%d %H:%M"
    # in CET. Tolerate ISO-8601 too. For naive results we attach the
    # frontend's effective timezone (Europe/Berlin) so engine math stays
    # tz-aware.
    dt: Optional[datetime] = None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        try:
            dt = datetime.strptime(s, "%Y-%m-%d %H:%M")
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_FALLBACK_TZ)
    return dt


def _driver_id(driver_info: Mapping[str, Any]) -> str:
    card = driver_info.get("card_number") or ""
    if card:
        return str(card)
    name = driver_info.get("driver_name") or ""
    if name:
        return str(name)
    return "unknown"


def _vehicle_id(vehicles: Iterable[Any]) -> Optional[str]:
    for v in vehicles or []:
        if not isinstance(v, Mapping):
            continue
        plate = (
            v.get("plate")
            or v.get("vehicle_registration_number")
            or v.get("vehicle_id")
        )
        if plate:
            return str(plate).strip() or None
    return None
