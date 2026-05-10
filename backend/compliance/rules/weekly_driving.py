"""EU 561 Art. 6(2) — weekly driving time (56h)."""

from __future__ import annotations

from backend.compliance.models import (
    AutomationHint,
    ComplianceContext,
    EvidenceItem,
    Violation,
)
from backend.compliance.rules._base import make_recommended_action
from backend.compliance.severity import severity_for_weekly_driving_excess


CODE = "EU_561_WEEKLY_DRIVING"
LEGAL_BASIS = "Art. 6 Abs. 2 VO (EG) Nr. 561/2006"


def evaluate(context: ComplianceContext) -> list[Violation]:
    profile = context.profile
    limit = profile.weekly_driving_limit_min
    out = []

    for w in context.facts.weekly_driving_summaries:
        if w.driver_id != context.driver_id:
            continue
        if w.driving_minutes <= limit:
            continue
        excess = w.driving_minutes - limit
        sev = severity_for_weekly_driving_excess(excess)
        out.append(
            Violation(
                driver_id=w.driver_id,
                country_profile=profile.code,
                rule_code=CODE,
                title="Wochenlenkzeit überschritten",
                title_de="Wochenlenkzeit überschritten",
                title_pl="Przekroczony tygodniowy czas jazdy",
                description=(
                    f"Tygodniowy czas jazdy {w.driving_minutes} min przekroczył "
                    f"limit {limit} min."
                ),
                legal_basis=LEGAL_BASIS,
                severity=sev,
                start=w.week_start,
                end=w.week_end,
                actual_minutes=w.driving_minutes,
                limit_minutes=limit,
                excess_minutes=excess,
                evidence=(
                    EvidenceItem(
                        start=w.week_start,
                        end=w.week_end,
                        activity_type="WEEK",
                        duration_minutes=w.driving_minutes,
                        note="aggregated weekly driving",
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
