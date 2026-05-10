"""Adapter: existing parser/analysis output -> ``NormalizedActivity[]``.

Safety contract:
* read-only on inputs (no mutation of dicts/lists/tuples),
* no recomputation of hours, shifts, days,
* no calls into the parser or analysis to "fix" data,
* unknown fields stay ``None`` — we do not invent values.

The function set is deliberately small:

* :func:`from_parsed_ddd` — takes the dict returned by ``parse_ddd_auto``
  and rebuilds the timeline through the existing helper
  ``core.timeline.build_timeline``. The timeline shape it returns
  (a list of ``(start, end, work_type, card_out)`` tuples with UTC-aware
  datetimes) is the canonical interchange format inside the backend.
* :func:`from_timeline` — takes a timeline already produced by the
  existing helper (or by a future Samsara-based normalizer that emits
  the same tuple shape) plus pre-extracted driver/vehicle info.
* :func:`map_activity_label` — string-label mapping. Useful if a future
  source uses textual labels ("driving", "Lenken", "POA", ...) instead
  of the integer constants ``DRIVING/WORK/AVAILABILITY/REST/UNKNOWN``.

Nothing else lives here; further normalisation is the engine's problem.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Mapping, Optional

# Importing the existing constants is read-only and does not change anything
# in the parser. We deliberately use the parser's integer enum (the values
# used by the timeline tuples), not a re-implementation. ``core`` resolves
# both when running from the repo root and from inside ``backend/``.
try:
    from core.constants import (
        AVAILABILITY,
        DRIVING,
        REST,
        UNKNOWN,
        WORK,
    )
except ModuleNotFoundError:  # pragma: no cover - only when path differs
    from backend.core.constants import (  # type: ignore[no-redef]
        AVAILABILITY,
        DRIVING,
        REST,
        UNKNOWN,
        WORK,
    )
from backend.compliance.models import (
    ActivitySource,
    ActivityType,
    NormalizedActivity,
)


# ---------------------------------------------------------------------------
# Label / integer mapping
# ---------------------------------------------------------------------------

_INT_TO_TYPE: Mapping[int, ActivityType] = {
    DRIVING: ActivityType.DRIVING,
    WORK: ActivityType.WORK,
    AVAILABILITY: ActivityType.AVAILABILITY,
    REST: ActivityType.REST,
    UNKNOWN: ActivityType.UNKNOWN,
}


# Lower-cased synonyms accepted from textual sources. We keep this list in
# the adapter only — the parser is free to use whatever names it wants.
_LABEL_TO_TYPE: dict[str, ActivityType] = {
    # driving
    "driving": ActivityType.DRIVING,
    "drive": ActivityType.DRIVING,
    "jazda": ActivityType.DRIVING,
    "fahren": ActivityType.DRIVING,
    "lenken": ActivityType.DRIVING,

    # other work
    "work": ActivityType.WORK,
    "other_work": ActivityType.WORK,
    "praca": ActivityType.WORK,
    "arbeit": ActivityType.WORK,

    # availability
    "availability": ActivityType.AVAILABILITY,
    "available": ActivityType.AVAILABILITY,
    "poa": ActivityType.AVAILABILITY,
    "dyspozycyjnosc": ActivityType.AVAILABILITY,
    "dyspozycyjność": ActivityType.AVAILABILITY,
    "bereitschaft": ActivityType.AVAILABILITY,

    # break
    "break": ActivityType.BREAK,
    "pause": ActivityType.BREAK,
    "przerwa": ActivityType.BREAK,

    # rest
    "rest": ActivityType.REST,
    "odpoczynek": ActivityType.REST,
    "ruhezeit": ActivityType.REST,
    "ruhe": ActivityType.REST,

    # unknown / gap
    "unknown": ActivityType.UNKNOWN,
    "gap": ActivityType.UNKNOWN,
    "missing": ActivityType.UNKNOWN,
    "brak danych": ActivityType.UNKNOWN,
}


def map_activity_label(value: Any) -> Optional[ActivityType]:
    """Map a parser activity label (int or str) to ``ActivityType``.

    Returns ``None`` if the value is unrecognised — the caller decides
    whether to drop the activity or surface it as UNKNOWN. The adapter
    never invents a type silently.
    """
    if value is None:
        return None
    if isinstance(value, ActivityType):
        return value
    if isinstance(value, bool):
        # ``bool`` is a subclass of int; reject it explicitly.
        return None
    if isinstance(value, int):
        return _INT_TO_TYPE.get(value)
    if isinstance(value, str):
        return _LABEL_TO_TYPE.get(value.strip().lower())
    return None


# ---------------------------------------------------------------------------
# Public adapters
# ---------------------------------------------------------------------------

def from_timeline(
    timeline: Iterable[tuple],
    driver_info: Optional[Mapping[str, Any]] = None,
    vehicles: Optional[Iterable[Mapping[str, Any]]] = None,
    *,
    source: ActivitySource = ActivitySource.DDD,
) -> list[NormalizedActivity]:
    """Adapt a pre-built timeline (UTC-aware tuples) to NormalizedActivity.

    Expected tuple shape: ``(start_dt, end_dt, work_type, card_out)`` as
    produced by ``core.timeline.build_timeline``. Additional trailing items
    are ignored. The tuple is *not* unpacked into mutable state; the input
    iterable is consumed by iteration only.

    ``driver_info`` and ``vehicles`` are read for ``driver_id`` and the
    first vehicle plate, respectively. Both are optional; absent values
    become safe defaults (``driver_id="unknown"``, ``vehicle_id=None``).
    """
    driver_id = _driver_id_from_info(driver_info)
    vehicle_id = _primary_vehicle_id(vehicles)

    out: list[NormalizedActivity] = []
    for entry in timeline:
        # Defensive unpacking — the parser may add more positional fields.
        if not entry or len(entry) < 3:
            continue
        start = _coerce_datetime(entry[0])
        end = _coerce_datetime(entry[1])
        work_type = entry[2]
        card_out = entry[3] if len(entry) >= 4 else None

        if start is None or end is None:
            continue
        if end <= start:
            continue

        kind = map_activity_label(work_type)
        if kind is None:
            # Unmapped values surface as UNKNOWN — they're still real time on
            # the timeline and the data-gap rule cares about them.
            kind = ActivityType.UNKNOWN

        out.append(
            NormalizedActivity(
                driver_id=driver_id,
                vehicle_id=vehicle_id,
                type=kind,
                start=start,
                end=end,
                source=source,
                # The existing parser does not yet propagate country /
                # ferry-train / multi-manning / OUT flags on the per-minute
                # timeline. We deliberately leave these as defaults rather
                # than guess.
                is_manual_entry=bool(card_out) if card_out is not None else False,
            )
        )

    return out


def from_parsed_ddd(
    parsed_data: Mapping[str, Any],
    *,
    source: ActivitySource = ActivitySource.DDD,
) -> list[NormalizedActivity]:
    """Adapt the dict returned by ``parse_ddd_auto`` to ``NormalizedActivity``.

    This function is a *read-only* convenience wrapper that calls the
    existing ``build_timeline`` / ``get_driver_info`` / ``get_vehicle_records``
    helpers. It does not mutate ``parsed_data`` and does not change how
    those helpers compute their output.
    """
    # Local imports keep this module importable even when the parser stack
    # is monkey-patched out in unit tests.
    from core.extractors import (
        get_activity_records,
        get_driver_info,
        get_vehicle_records,
    )
    from core.timeline import build_timeline

    records = get_activity_records(parsed_data)
    timeline = build_timeline(records)
    driver_info = get_driver_info(parsed_data)
    vehicles = get_vehicle_records(parsed_data)

    return from_timeline(timeline, driver_info, vehicles, source=source)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce_datetime(value: Any) -> Optional[datetime]:
    """Accept ``datetime`` or ISO-8601 string (handy when the timeline
    arrives over HTTP). Returns ``None`` if the value can't be coerced —
    the caller drops that entry rather than invent a timestamp.
    """
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _driver_id_from_info(driver_info: Optional[Mapping[str, Any]]) -> str:
    if not driver_info:
        return "unknown"
    card = driver_info.get("card_number") or ""
    if card:
        return str(card)
    name = driver_info.get("driver_name") or ""
    if name:
        return str(name)
    return "unknown"


def _primary_vehicle_id(vehicles: Optional[Iterable[Mapping[str, Any]]]) -> Optional[str]:
    if not vehicles:
        return None
    for v in vehicles:
        if not isinstance(v, Mapping):
            continue
        # Prefer canonical plate fields used by the existing extractor.
        plate = (
            v.get("vehicle_registration_number")
            or v.get("plate")
            or v.get("vehicle_id")
        )
        if plate:
            return str(plate).strip() or None
    return None
