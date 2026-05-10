"""EU 561 Art. 6(1) — daily driving time.

Violations:
* hard breach when daily driving > 10h (extended limit),
* soft breach when more than two extensions (>9h, <=10h) in one transport
  week.

TODO: Frame days from rest-to-rest rather than calendar days. The current
fact builder uses a calendar-day fallback, which under-counts duty crossing
midnight by a small amount. See ``facts/daily_work_periods.py``.
"""

from __future__ import annotations

from backend.compliance.models import (
    AutomationHint,
    ComplianceContext,
    EvidenceItem,
    Severity,
    Violation,
)
from backend.compliance.rules._base import make_recommended_action
from backend.compliance.severity import severity_for_daily_driving_excess


CODE = "EU_561_DAILY_DRIVING"
CODE_TOO_MANY_EXT = "EU_561_DAILY_DRIVING_EXTENSIONS"
LEGAL_BASIS = "Art. 6 Abs. 1 VO (EG) Nr. 561/2006"


def evaluate(context: ComplianceContext) -> list[Violation]:
    profile = context.profile
    out: list[Violation] = []

    # 1) Hard breach: > 10h.
    for s in context.facts.daily_driving_summaries:
        if s.driver_id != context.driver_id:
            continue
        if s.driving_minutes <= profile.daily_driving_extended_min:
            continue

        excess = s.driving_minutes - profile.daily_driving_extended_min
        sev = severity_for_daily_driving_excess(excess)
        out.append(
            Violation(
                driver_id=s.driver_id,
                country_profile=profile.code,
                rule_code=CODE,
                title="Tageslenkzeit überschritten",
                title_de="Tageslenkzeit überschritten",
                title_pl="Przekroczony dzienny czas jazdy",
                description=(
                    f"Dzienny czas jazdy {s.driving_minutes} min przekroczył "
                    f"limit wydłużony {profile.daily_driving_extended_min} min."
                ),
                legal_basis=LEGAL_BASIS,
                severity=sev,
                start=s.period_start,
                end=s.period_end,
                actual_minutes=s.driving_minutes,
                limit_minutes=profile.daily_driving_extended_min,
                excess_minutes=excess,
                evidence=(
                    EvidenceItem(
                        start=s.period_start,
                        end=s.period_end,
                        activity_type="DAY",
                        duration_minutes=s.driving_minutes,
                        note="aggregated driving for this day",
                    ),
                ),
                recommended_action=make_recommended_action(sev.value),
                automation=AutomationHint(
                    notify_transport_manager=True,
                    notify_driver=True,
                    create_case=True,
                ),
                extra={
                    "isCalendarDayFallback": True,
                },
            )
        )

    # 2) More than allowed extensions per week.
    for w in context.facts.weekly_driving_summaries:
        if w.driver_id != context.driver_id:
            continue
        if w.extended_days_count <= profile.weekly_extensions_allowed:
            continue

        evidence = [
            EvidenceItem(
                start=d.period_start,
                end=d.period_end,
                activity_type="DAY",
                duration_minutes=d.driving_minutes,
                note="extended day (>9h)",
            )
            for d in w.daily_summaries if d.is_extended_to_10h
        ]

        out.append(
            Violation(
                driver_id=w.driver_id,
                country_profile=profile.code,
                rule_code=CODE_TOO_MANY_EXT,
                title="Zu viele 10-Stunden-Lenktage in der Woche",
                title_de="Zu viele 10-Stunden-Lenktage in der Woche",
                title_pl="Zbyt wiele wydłużeń dziennego czasu jazdy w tygodniu",
                description=(
                    f"W tygodniu transportowym wystąpiły {w.extended_days_count} "
                    f"dni z jazdą >9h przy dozwolonych "
                    f"{profile.weekly_extensions_allowed}."
                ),
                legal_basis=LEGAL_BASIS,
                severity=Severity.HIGH,
                start=w.week_start,
                end=w.week_end,
                actual_minutes=w.extended_days_count,
                limit_minutes=profile.weekly_extensions_allowed,
                excess_minutes=w.extended_days_count - profile.weekly_extensions_allowed,
                evidence=tuple(evidence),
                recommended_action=make_recommended_action("HIGH"),
                automation=AutomationHint(
                    notify_transport_manager=True,
                    notify_driver=True,
                    create_case=True,
                ),
            )
        )

    return out
