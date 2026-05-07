"""Adapter: DDD parsed data → compliance engine input.

The TS engine takes a JSON payload that mirrors its `NormalizerInput`. Our
parser already produces a per-day timeline (a list of
`(start_dt, end_dt, work_type, card_out)` tuples) plus side streams (places,
events, vehicle records). This module bundles those into the engine's
expected shape and clips them to a requested month window.

Keep this file deterministic — it must produce the same payload bytes for
the same inputs so engine output stays cacheable / reproducible.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Mapping

from core.constants import REST, AVAILABILITY, WORK, DRIVING, UNKNOWN


_KIND = {
    REST: "REST",
    AVAILABILITY: "AVAILABILITY",
    WORK: "WORK",
    DRIVING: "DRIVING",
    UNKNOWN: "UNKNOWN",
}


def month_range_utc(year: int, month: int) -> tuple[datetime, datetime]:
    """Inclusive start, exclusive end of the given calendar month, in UTC."""
    if month < 1 or month > 12:
        raise ValueError(f"invalid month: {month}")
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _to_utc(dt: Any) -> datetime | None:
    """Best-effort coerce to a UTC-aware datetime.

    Returns ``None`` if the input cannot be normalised — caller decides
    what to do (typically: drop the activity). Without this guard a single
    bad record would crash the whole month with the classic
    "'<' not supported between instances of 'str' and 'NoneType'".
    """
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    if isinstance(dt, str):
        return _normalize_event_dt(dt)
    return None


def _iso(dt: datetime) -> str:
    return _to_utc(dt).isoformat().replace("+00:00", "Z")


def _clip(
    start: Any,
    end: Any,
    lo: datetime,
    hi: datetime,
) -> tuple[datetime, datetime] | None:
    s_utc = _to_utc(start)
    e_utc = _to_utc(end)
    if s_utc is None or e_utc is None:
        return None
    s = max(s_utc, lo)
    e = min(e_utc, hi)
    if s >= e:
        return None
    return s, e


def build_engine_payload(
    *,
    driver_card: str,
    timeline: Iterable[tuple[datetime, datetime, int, bool]],
    places: Iterable[Mapping[str, Any]] = (),
    events: Iterable[Mapping[str, Any]] = (),
    vehicle: str | None = None,
    range_start: datetime,
    range_end: datetime,
    rules_root: str,
    time_zone: str = "Europe/Berlin",
    locale: str = "de",
    administrative: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the JSON the TS engine expects.

    Activities are clipped to ``[range_start, range_end)``. Country codes are
    lifted from the matching `card_places` entries (start_country attached
    to the day boundary, end_country to the day end).
    """
    range_start_utc = _to_utc(range_start)
    range_end_utc = _to_utc(range_end)
    if range_start_utc is None or range_end_utc is None:
        raise ValueError(
            "build_engine_payload: range_start/range_end must coerce to "
            f"UTC datetimes (got {range_start!r} / {range_end!r})",
        )
    range_start = range_start_utc
    range_end = range_end_utc

    activity_candidates: list[dict[str, Any]] = []
    last_country_at_minute_zero: dict[str, str | None] = {}

    # Build a lookup of place entries per day for country annotations.
    by_day_start: dict[str, str] = {}
    by_day_end: dict[str, str] = {}
    for p in places:
        day_str = str(p.get("date", ""))[:10]
        country = p.get("country") or None
        if not (day_str and country):
            continue
        ptype = (p.get("type") or "").lower()
        if ptype == "start" and day_str not in by_day_start:
            by_day_start[day_str] = country
        elif ptype == "end" and day_str not in by_day_end:
            by_day_end[day_str] = country

    for s, e, wt, card_out in timeline:
        clipped = _clip(s, e, range_start, range_end)
        if not clipped:
            continue
        cs, ce = clipped
        kind = _KIND.get(wt, "UNKNOWN")
        day_str = cs.date().isoformat()

        start_country = by_day_start.get(day_str)
        end_country = None
        if ce.time() >= time(20, 0):  # end-of-day region; loose match
            end_country = by_day_end.get(day_str)

        # Track last assigned country per day so we annotate only the very
        # first activity of each day with start_country.
        prev = last_country_at_minute_zero.get(day_str)
        if prev is not None:
            start_country = None
        else:
            last_country_at_minute_zero[day_str] = start_country

        activity_candidates.append(
            {
                "driver_id": driver_card,
                "vehicle_id": vehicle,
                "kind": kind,
                "source": "MANUAL_ENTRY" if card_out else "CARD",
                "slot": "DRIVER",
                "card_inserted": not bool(card_out),
                "out_of_scope": False,
                "ferry_train": False,
                "start_country": start_country,
                "end_country": end_country,
                "confidence": 0.9 if kind == "UNKNOWN" else 1.0,
                "notes": [],
                "start": _iso(cs),
                "end": _iso(ce),
            },
        )

    # card_sessions: one synthetic session per inserted-card run. We collapse
    # consecutive non-card-out intervals (regardless of work_type) into a
    # session, and annotate it with the day's first/last country.
    card_sessions: list[dict[str, Any]] = []
    open_session: dict[str, Any] | None = None
    for a in activity_candidates:
        if a["card_inserted"]:
            if open_session is None:
                open_session = {
                    "driver_id": driver_card,
                    "vehicle_id": vehicle,
                    "start_country": a.get("start_country"),
                    "end_country": None,
                    "start_odometer_km": None,
                    "end_odometer_km": None,
                    "start": a["start"],
                    "end": a["end"],
                }
            else:
                open_session["end"] = a["end"]
                if a.get("end_country"):
                    open_session["end_country"] = a["end_country"]
        else:
            if open_session is not None:
                card_sessions.append(open_session)
                open_session = None
    if open_session is not None:
        card_sessions.append(open_session)

    # events: minimal pass-through. The DDD parser exposes `event_type` codes;
    # we keep the raw type and let the engine classify them by prefix.
    engine_events: list[dict[str, Any]] = []
    for ev in events:
        begin = _normalize_event_dt(ev.get("event_begin_time") or ev.get("begin"))
        end_dt = _normalize_event_dt(ev.get("event_end_time") or ev.get("end"))
        if begin is None:
            continue
        if not (range_start <= begin < range_end):
            continue
        engine_events.append(
            {
                "driver_id": driver_card,
                "vehicle_id": vehicle,
                "type": str(ev.get("event_type") or ev.get("type") or "EVENT_UNKNOWN"),
                "begin": _iso(begin),
                "end": _iso(end_dt) if end_dt else None,
                "raw_code": str(ev.get("event_record_purpose") or "") or None,
                "notes": [],
            },
        )

    payload: dict[str, Any] = {
        "rules_root": rules_root,
        "time_zone": time_zone,
        "evaluated_at": _iso(datetime.now(timezone.utc)),
        "driver_id": driver_card,
        "range": {"start": _iso(range_start), "end": _iso(range_end)},
        "activity_candidates": activity_candidates,
        "card_sessions": card_sessions,
        "manual_entries": [],
        "events": engine_events,
        "printouts": [],
        "locale": locale,
    }
    if administrative is not None:
        payload["administrative"] = dict(administrative)
    return payload


def _normalize_event_dt(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return _to_utc(value)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    if isinstance(value, str):
        s = value.replace("Z", "+00:00")
        try:
            return _to_utc(datetime.fromisoformat(s))
        except ValueError:
            try:
                return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            except ValueError:
                return None
    return None


def is_record_in_month(record_date_str: str, year: int, month: int) -> bool:
    """Quick filter for choosing daily records that touch the given month."""
    if not record_date_str:
        return False
    try:
        d = datetime.strptime(record_date_str[:10], "%Y-%m-%d").date()
    except ValueError:
        return False
    return d.year == year and d.month == month


def expand_padding(year: int, month: int, padding_days: int = 7) -> tuple[datetime, datetime]:
    """Range that includes the requested month plus a few days on each side.

    Used when picking DDD records to feed the engine: rolling 2-week driving
    and weekly rest both need the previous and next week to evaluate the
    boundaries of the selected month correctly. The engine itself trims
    output back to the strict month range.
    """
    start, end = month_range_utc(year, month)
    return start - timedelta(days=padding_days), end + timedelta(days=padding_days)


__all__ = [
    "build_engine_payload",
    "month_range_utc",
    "expand_padding",
    "is_record_in_month",
]
