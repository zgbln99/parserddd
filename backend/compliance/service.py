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
