"""EU 561 Art. 6(3) — two-week driving time (90h)."""

from __future__ import annotations

from backend.compliance.models import (
    AutomationHint,
    ComplianceContext,
    EvidenceItem,
    Violation,
)
from backend.compliance.rules._base import make_recommended_action
from backend.compliance.severity import severity_for_fortnightly_driving_excess


CODE = "EU_561_FORTNIGHTLY_DRIVING"
LEGAL_BASIS = "Art. 6 Abs. 3 VO (EG) Nr. 561/2006"


def evaluate(context: ComplianceContext) -> list[Violation]:
    profile = context.profile
    limit = profile.fortnightly_driving_limit_min
    out: list[Violation] = []

    # A 90h limit is only meaningful when at least two full transport
    # weeks are in scope. Below that we don't have enough context to
    # claim a breach and the rule would emit false positives on short
    # snapshots.
    # TODO: emit INSUFFICIENT_DATA when reporting supports it.
    if not context.facts.coverage.sufficient_for_fortnightly_rules:
        return out

    for f in context.facts.fortnightly_driving_summaries:
        if f.driver_id != context.driver_id:
            continue
        if f.driving_minutes <= limit:
            continue
        excess = f.driving_minutes - limit
        sev = severity_for_fortnightly_driving_excess(excess)
        out.append(
            Violation(
                driver_id=f.driver_id,
                country_profile=profile.code,
                rule_code=CODE,
                title="Doppelwochenlenkzeit überschritten",
                title_de="Doppelwochenlenkzeit überschritten",
                title_pl="Przekroczony dwutygodniowy czas jazdy",
                description=(
                    f"Suma jazdy w dwóch kolejnych tygodniach {f.driving_minutes} min "
                    f"przekroczyła limit {limit} min."
                ),
                legal_basis=LEGAL_BASIS,
                severity=sev,
                start=f.week_start,
                end=f.week_end,
                actual_minutes=f.driving_minutes,
                limit_minutes=limit,
                excess_minutes=excess,
                evidence=(
                    EvidenceItem(
                        start=f.week_start,
                        end=f.week_end,
                        activity_type="FORTNIGHT",
                        duration_minutes=f.driving_minutes,
                        note="rolling 2-week driving total",
                    ),
                ),
                recommended_action=make_recommended_action(sev.value),
                automation=AutomationHint(
                    notify_transport_manager=True,
                    notify_driver=True,
                    create_case=True,
                ),
            )
        )
    return out
