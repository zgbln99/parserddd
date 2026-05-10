"""ComplianceEngine — orchestration over fact builders and rules.

Public surface:
* ``ComplianceEngine.evaluate(activities, ...)`` -> ``list[Violation]``
* ``build_webhook_event(violation)`` -> ``dict`` ready for n8n / a webhook.

The engine is intentionally minimal: build facts once, run each rule on
them, return the merged violation list. No IO, no DB, no AI.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Iterable, Optional

from backend.compliance.facts import (
    build_daily_driving_summaries,
    build_daily_work_periods,
    build_data_gaps,
    build_driving_blocks,
    build_fortnightly_driving_summaries,
    build_rest_periods,
    build_weekly_driving_summaries,
)
from backend.compliance.models import (
    ComplianceContext,
    ComplianceFacts,
    Coverage,
    NormalizedActivity,
    Violation,
)
from backend.compliance.profiles import CountryProfile, DE_PROFILE
from backend.compliance.rules import (
    continuous_driving,
    daily_driving,
    daily_rest,
    fortnightly_driving,
    missing_card_or_data_gap,
    weekly_driving,
    weekly_rest,
)


# A rule, in this module, is a function with the signature
# ``(ComplianceContext) -> list[Violation]``. Rule modules expose ``evaluate``;
# we collect them here so the engine doesn't grow if/elses.
RuleFn = Callable[[ComplianceContext], list[Violation]]


DEFAULT_RULES: tuple[RuleFn, ...] = (
    continuous_driving.evaluate,
    daily_driving.evaluate,
    weekly_driving.evaluate,
    fortnightly_driving.evaluate,
    daily_rest.evaluate,
    weekly_rest.evaluate,
    missing_card_or_data_gap.evaluate,
)


class ComplianceEngine:
    """Stateless evaluator. Construct once, call ``evaluate`` per analysis."""

    def __init__(
        self,
        *,
        profile: CountryProfile = DE_PROFILE,
        rules: Iterable[RuleFn] = DEFAULT_RULES,
    ):
        self.profile = profile
        self.rules: tuple[RuleFn, ...] = tuple(rules)

    def build_facts(
        self,
        activities: Iterable[NormalizedActivity],
        *,
        period_start: Optional[datetime] = None,
        period_end: Optional[datetime] = None,
    ) -> ComplianceFacts:
        acts = list(activities)
        driving_blocks = build_driving_blocks(
            acts,
            required_break_min=self.profile.required_break_min,
            split_first_min=self.profile.split_break_first_min,
            split_second_min=self.profile.split_break_second_min,
        )
        daily_periods = build_daily_work_periods(
            acts, timezone=self.profile.timezone
        )
        daily_sums = build_daily_driving_summaries(
            acts,
            timezone=self.profile.timezone,
            daily_normal_min=self.profile.daily_driving_normal_min,
        )
        weekly_sums = build_weekly_driving_summaries(
            acts, daily_sums, timezone=self.profile.timezone
        )
        fortnight_sums = build_fortnightly_driving_summaries(weekly_sums)
        rests = build_rest_periods(acts)
        gaps = build_data_gaps(
            acts, period_start=period_start, period_end=period_end,
            min_gap_minutes=self.profile.data_gap_warn_min,
        )
        coverage = _coverage_for(acts, period_start, period_end)
        return ComplianceFacts(
            driving_blocks=tuple(driving_blocks),
            daily_work_periods=tuple(daily_periods),
            daily_driving_summaries=tuple(daily_sums),
            weekly_driving_summaries=tuple(weekly_sums),
            fortnightly_driving_summaries=tuple(fortnight_sums),
            rest_periods=tuple(rests),
            data_gaps=tuple(gaps),
            coverage=coverage,
        )

    def evaluate(
        self,
        activities: Iterable[NormalizedActivity],
        *,
        period_start: Optional[datetime] = None,
        period_end: Optional[datetime] = None,
    ) -> list[Violation]:
        """Evaluate all rules per driver. Returns a flat list of violations."""
        acts = list(activities)
        if not acts:
            return []

        facts = self.build_facts(
            acts, period_start=period_start, period_end=period_end
        )

        # Group activities by driver so each driver gets its own context.
        by_driver: dict[str, list[NormalizedActivity]] = {}
        for a in acts:
            by_driver.setdefault(a.driver_id, []).append(a)

        results: list[Violation] = []
        for driver_id, driver_acts in by_driver.items():
            context = ComplianceContext(
                driver_id=driver_id,
                activities=tuple(driver_acts),
                facts=facts,
                profile=self.profile,
                timezone=self.profile.timezone,
                period_start=period_start,
                period_end=period_end,
            )
            for rule in self.rules:
                results.extend(rule(context))

        # Deterministic order for stable output.
        results.sort(key=lambda v: (v.driver_id, v.start, v.rule_code))
        return results


# ---------------------------------------------------------------------------
# Webhook / automation event payload
# ---------------------------------------------------------------------------

def _coverage_for(
    activities: list[NormalizedActivity],
    period_start: Optional[datetime],
    period_end: Optional[datetime],
) -> Coverage:
    """Coverage = max(end) - min(start) of activities, clipped to the
    requested analysis window when one is provided.
    """
    if not activities:
        return Coverage()
    start = min(a.start for a in activities)
    end = max(a.end for a in activities)
    if period_start is not None:
        start = max(start, period_start)
    if period_end is not None:
        end = min(end, period_end)
    if end <= start:
        return Coverage(period_start=start, period_end=end, minutes=0)
    minutes = int((end - start).total_seconds() // 60)
    return Coverage(period_start=start, period_end=end, minutes=minutes)


def build_webhook_event(violation: Violation) -> dict[str, Any]:
    """Render a violation as the wire format for n8n / generic webhooks."""
    return {
        "event": "tachograph.violation.detected",
        "driverId": violation.driver_id,
        "vehicleId": violation.vehicle_id,
        "countryProfile": violation.country_profile,
        "ruleCode": violation.rule_code,
        "severity": violation.severity.value,
        "start": violation.start.isoformat(),
        "end": violation.end.isoformat(),
        "violation": violation.to_dict(),
    }
