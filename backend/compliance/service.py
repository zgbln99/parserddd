"""Entry points for running compliance against existing parser output.

This module is the *only* place that wires the existing parser/analysis
layer to the compliance engine. It contains no rule logic, no hour
calculation, and does not mutate its inputs.

Two thin entry points:

* :func:`evaluate_parser_analysis_for_violations` — accepts either the
  dict from ``parse_ddd_auto`` or the result of ``analyze_card`` (the
  latter only needs to carry ``timeline`` / ``driver_info`` / ``vehicles``
  if the caller wants to skip the parsed-DDD path; we never expect
  analysis numbers like ``total_work_minutes`` to be re-derived).
* :func:`build_webhook_events` — render each violation as a webhook
  payload via the engine's :func:`build_webhook_event` helper.

The result is a dict — small, additive, easy to drop next to an existing
response without touching its keys.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Optional

from backend.compliance.adapters import from_parsed_ddd, from_timeline
from backend.compliance.engine import (
    ComplianceEngine,
    build_webhook_event,
)
from backend.compliance.models import (
    ActivitySource,
    ActivityType,
    NormalizedActivity,
    Violation,
)
from backend.compliance.profiles import (
    DE_PROFILE,
    EU_561_PROFILE,
    CountryProfile,
)


_PROFILES_BY_CODE: dict[str, CountryProfile] = {
    "DE": DE_PROFILE,
    "EU": EU_561_PROFILE,
}


def _resolve_profile(country_profile: str | CountryProfile) -> CountryProfile:
    if isinstance(country_profile, CountryProfile):
        return country_profile
    code = (country_profile or "DE").upper()
    return _PROFILES_BY_CODE.get(code, DE_PROFILE)


def evaluate_parser_analysis_for_violations(
    parser_analysis: Mapping[str, Any],
    *,
    country_profile: str | CountryProfile = "DE",
    include_events: bool = False,
) -> dict[str, Any]:
    """Run compliance on the output of the existing parser/analysis layer.

    The function is **non-mutating**. ``parser_analysis`` is read but
    never modified; the existing analysis result is returned to the
    caller unchanged.

    ``parser_analysis`` can be one of:

    * the dict returned by ``parse_ddd_auto`` (it has the raw
      ``card_driver_activity_1`` / ``..._2`` blocks),
    * a result dict that carries an already-built ``timeline`` plus
      ``driver_info`` / ``vehicles`` (handy when a caller wants to reuse
      the result of ``analyze_card`` without re-parsing).

    Returns::

        {
            "countryProfile": "DE",
            "violations": [<Violation.to_dict()>, ...],
            "events": [<webhook event>, ...]   # only when include_events
        }
    """
    profile = _resolve_profile(country_profile)
    activities = _normalize_activities(parser_analysis)

    engine = ComplianceEngine(profile=profile)
    violations: list[Violation] = engine.evaluate(activities)

    payload: dict[str, Any] = {
        "countryProfile": profile.code,
        "violations": [v.to_dict() for v in violations],
    }
    if include_events:
        payload["events"] = [build_webhook_event(v) for v in violations]
    return payload


def build_webhook_events(violations: Iterable[Violation]) -> list[dict[str, Any]]:
    """Render a list of ``Violation`` objects as webhook event dicts."""
    return [build_webhook_event(v) for v in violations]


# ---------------------------------------------------------------------------
# Inspection / diagnostics
# ---------------------------------------------------------------------------

_ACTIVITY_TYPES_ORDER = (
    "DRIVING", "WORK", "AVAILABILITY", "BREAK", "REST", "UNKNOWN",
)
_SEVERITY_ORDER = ("INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL")


def inspect_parser_analysis(
    parser_analysis: Mapping[str, Any],
    *,
    country_profile: str | CountryProfile = "DE",
    show_activities: bool = False,
    gap_warn_minutes: int = 15,
) -> dict[str, Any]:
    """Diagnostic summary of what compliance sees from ``parser_analysis``.

    Returns a dict that mirrors the engine's view of the data:

    * ``activitySummary`` — count, time range, per-type count/minutes.
    * ``driver`` — driver/vehicle ids the adapter extracted.
    * ``violationsSummary`` — count, severity histogram, per-rule histogram.
    * ``dataGaps`` — count of gaps detected by the engine's fact builders.
    * ``violations`` — full ``Violation.to_dict()`` payloads.

    Uses the same adapter and the same ``ComplianceEngine`` instance the
    HTTP endpoint uses. No rule logic is duplicated; we ask the engine to
    build its facts and then read them.
    """
    profile = _resolve_profile(country_profile)
    activities = _normalize_activities(parser_analysis)

    if not activities:
        empty: dict[str, Any] = {
            "countryProfile": profile.code,
            "activitySummary": _empty_activity_summary(),
            "coverage": _empty_coverage(),
            "driver": {"driverId": None, "vehicleId": None},
            "violationsSummary": _empty_violation_summary(),
            "dataGaps": {"count": 0},
            "violations": [],
        }
        if show_activities:
            empty["activities"] = []
            empty["diagnostics"] = {"warnings": []}
        return empty

    engine = ComplianceEngine(profile=profile)
    facts = engine.build_facts(activities)
    violations: list[Violation] = engine.evaluate(activities)

    by_type: dict[str, dict[str, int]] = {
        t: {"count": 0, "minutes": 0} for t in _ACTIVITY_TYPES_ORDER
    }
    for a in activities:
        bucket = by_type.setdefault(
            a.type.value, {"count": 0, "minutes": 0}
        )
        bucket["count"] += 1
        bucket["minutes"] += a.duration_minutes()

    period_start = min(a.start for a in activities).isoformat()
    period_end = max(a.end for a in activities).isoformat()

    by_severity = {s: 0 for s in _SEVERITY_ORDER}
    by_rule: dict[str, int] = {}
    for v in violations:
        by_severity[v.severity.value] = by_severity.get(v.severity.value, 0) + 1
        by_rule[v.rule_code] = by_rule.get(v.rule_code, 0) + 1

    # Pick driver/vehicle from the first activity. The adapter already
    # decided what those values are; we just surface them here.
    first = activities[0]
    driver_block = {
        "driverId": first.driver_id,
        "vehicleId": next(
            (a.vehicle_id for a in activities if a.vehicle_id), None
        ),
    }

    cov = facts.coverage
    coverage_block = {
        "periodStart": cov.period_start.isoformat() if cov.period_start else None,
        "periodEnd": cov.period_end.isoformat() if cov.period_end else None,
        "minutes": cov.minutes,
        "days": round(cov.days, 4),
        "sufficientForWeeklyRules": cov.sufficient_for_weekly_rules,
        "sufficientForFortnightlyRules": cov.sufficient_for_fortnightly_rules,
    }

    result: dict[str, Any] = {
        "countryProfile": profile.code,
        "activitySummary": {
            "count": len(activities),
            "periodStart": period_start,
            "periodEnd": period_end,
            "byType": by_type,
        },
        "coverage": coverage_block,
        "driver": driver_block,
        "violationsSummary": {
            "count": len(violations),
            "bySeverity": by_severity,
            "byRule": by_rule,
        },
        "dataGaps": {"count": len(facts.data_gaps)},
        "violations": [v.to_dict() for v in violations],
    }

    if show_activities:
        activities_block, diagnostics = _build_adapter_diagnostics(
            parser_analysis, activities, gap_warn_minutes=gap_warn_minutes,
        )
        result["activities"] = activities_block
        result["diagnostics"] = diagnostics

    return result


def _empty_activity_summary() -> dict[str, Any]:
    return {
        "count": 0,
        "periodStart": None,
        "periodEnd": None,
        "byType": {
            t: {"count": 0, "minutes": 0} for t in _ACTIVITY_TYPES_ORDER
        },
    }


def _build_adapter_diagnostics(
    parser_analysis: Mapping[str, Any],
    activities: list[NormalizedActivity],
    *,
    gap_warn_minutes: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Build the activities listing + warnings shown under ``--show-activities``.

    The function is intentionally read-only: it walks the post-adapter
    activities (already produced upstream) and, when present, the *raw*
    timeline tuples on ``parser_analysis`` to flag entries the adapter
    silently dropped (``end <= start``).
    """
    from datetime import datetime

    sorted_acts = sorted(activities, key=lambda a: (a.start, a.end))
    activities_block: list[dict[str, Any]] = []
    for i, a in enumerate(sorted_acts):
        activities_block.append({
            "index": i,
            "driverId": a.driver_id,
            "vehicleId": a.vehicle_id,
            "type": a.type.value,
            "start": a.start.isoformat(),
            "end": a.end.isoformat(),
            "durationMinutes": a.duration_minutes(),
            "source": a.source.value if a.source else None,
            "rawRef": a.raw_ref,
            "flags": {
                "isManualEntry": a.is_manual_entry,
                "isOutOfScope": a.is_out_of_scope,
                "isFerryTrain": a.is_ferry_train,
                "isMultiManning": a.is_multi_manning,
            },
        })

    warnings: list[dict[str, Any]] = []

    # 1) INVALID_TIME_RANGE — scan the raw timeline (if supplied directly).
    # The adapter drops those, so they would not appear in ``activities``.
    raw_tl = parser_analysis.get("timeline") if isinstance(parser_analysis, Mapping) else None
    if isinstance(raw_tl, (list, tuple)):
        for j, entry in enumerate(raw_tl):
            if not entry or len(entry) < 2:
                continue
            s = _coerce_inspect_dt(entry[0])
            e = _coerce_inspect_dt(entry[1])
            if s is None or e is None:
                continue
            if e <= s:
                warnings.append({
                    "type": "INVALID_TIME_RANGE",
                    "index": j,
                    "start": s.isoformat(),
                    "end": e.isoformat(),
                    "message": "Activity end is not after start",
                })

    # 2) UNKNOWN_ACTIVITY — any post-adapter UNKNOWN slice.
    for i, a in enumerate(sorted_acts):
        if a.type == ActivityType.UNKNOWN:
            warnings.append({
                "type": "UNKNOWN_ACTIVITY",
                "index": i,
                "start": a.start.isoformat(),
                "end": a.end.isoformat(),
                "message": "Activity mapped to UNKNOWN",
            })

    # 3) GAP — wall-clock gap between consecutive activities for the same
    # driver. Strictly greater than the threshold (15 min by default).
    by_driver: dict[str, list[NormalizedActivity]] = {}
    for a in sorted_acts:
        by_driver.setdefault(a.driver_id, []).append(a)
    for driver_acts in by_driver.values():
        for prev, cur in zip(driver_acts, driver_acts[1:]):
            if cur.start <= prev.end:
                continue
            minutes = int((cur.start - prev.end).total_seconds() // 60)
            if minutes > gap_warn_minutes:
                warnings.append({
                    "type": "GAP",
                    "start": prev.end.isoformat(),
                    "end": cur.start.isoformat(),
                    "durationMinutes": minutes,
                    "message": "Gap between normalized activities",
                })

    return activities_block, {"warnings": warnings}


def _coerce_inspect_dt(value: Any):
    """Coerce raw-timeline values for diagnostic inspection only.

    Mirrors the adapter's tolerance for ISO strings; not used by the
    engine. Returns ``None`` for anything that doesn't parse.
    """
    from datetime import datetime

    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _empty_coverage() -> dict[str, Any]:
    return {
        "periodStart": None,
        "periodEnd": None,
        "minutes": 0,
        "days": 0.0,
        "sufficientForWeeklyRules": False,
        "sufficientForFortnightlyRules": False,
    }


def _empty_violation_summary() -> dict[str, Any]:
    return {
        "count": 0,
        "bySeverity": {s: 0 for s in _SEVERITY_ORDER},
        "byRule": {},
    }


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _normalize_activities(
    parser_analysis: Mapping[str, Any],
) -> list[NormalizedActivity]:
    """Pick the right adapter path without mutating ``parser_analysis``."""
    if not isinstance(parser_analysis, Mapping):
        return []

    # Path 1: caller passed an already-built timeline. This avoids any
    # re-parsing and is what tests / future callers should prefer.
    timeline = parser_analysis.get("timeline")
    if isinstance(timeline, (list, tuple)) and timeline:
        return from_timeline(
            timeline,
            parser_analysis.get("driver_info"),
            parser_analysis.get("vehicles"),
            source=_resolve_source(parser_analysis),
        )

    # Path 2: caller passed the parsed-DDD dict directly. We delegate to
    # the existing helpers; this does not change parser behaviour.
    if any(k in parser_analysis for k in (
        "card_driver_activity_1", "card_driver_activity_2",
    )):
        return from_parsed_ddd(parser_analysis, source=_resolve_source(parser_analysis))

    return []


def _resolve_source(parser_analysis: Mapping[str, Any]) -> ActivitySource:
    src = parser_analysis.get("source")
    if isinstance(src, ActivitySource):
        return src
    if isinstance(src, str):
        try:
            return ActivitySource(src.upper())
        except ValueError:
            pass
    return ActivitySource.DDD
