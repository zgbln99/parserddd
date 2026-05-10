"""EU 561 Art. 8(6) — weekly rest (preliminary).

Initial implementation: for each transport week we look for the longest
rest period that overlaps the week and apply two checks:

* < 24h (or no rest at all) -> violation,
* 24h..<45h -> reduced weekly rest, set ``compensationRequired = true``
  in ``extra``. Tracking the actual compensation across the rolling
  4-week window is a TODO.

TODO: True legal definition pairs each weekly rest with the rest immediately
preceding/following it across the 6-day driving rule. Implement once we have
enough surrounding context.
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
from backend.compliance.severity import severity_for_short_weekly_rest


CODE_MISSING = "EU_561_WEEKLY_REST_MISSING"
CODE_SHORT = "EU_561_WEEKLY_REST_SHORT"
CODE_REDUCED = "EU_561_WEEKLY_REST_REDUCED"
LEGAL_BASIS = "Art. 8 Abs. 6 VO (EG) Nr. 561/2006"


def evaluate(context: ComplianceContext) -> list[Violation]:
    profile = context.profile
    out: list[Violation] = []

    rests = [
        r for r in context.facts.rest_periods if r.driver_id == context.driver_id
    ]

    for week in context.facts.weekly_driving_summaries:
        if week.driver_id != context.driver_id:
            continue

        # Longest rest that overlaps this week — but only count a rest as
        # a *weekly-rest candidate* if it's clearly longer than a typical
        # daily rest. Otherwise the week has no weekly rest at all.
        candidate = None
        weekly_candidate_floor = profile.daily_rest_regular_min
        for r in rests:
            if r.end <= week.week_start or r.start >= week.week_end:
                continue
            if r.minutes <= weekly_candidate_floor:
                continue
            if candidate is None or r.minutes > candidate.minutes:
                candidate = r

        if candidate is None:
            # No weekly rest at all in this week — report as warning unless
            # the period is partial.
            out.append(
                Violation(
                    driver_id=context.driver_id,
                    country_profile=profile.code,
                    rule_code=CODE_MISSING,
                    title="Wöchentliche Ruhezeit nicht erkennbar",
                    title_de="Wöchentliche Ruhezeit nicht erkennbar",
                    title_pl="Brak rozpoznawalnego odpoczynku tygodniowego",
                    description=(
                        "W analizowanym tygodniu nie wykryto okresu odpoczynku "
                        "kwalifikującego się jako odpoczynek tygodniowy. "
                        "Wymaga weryfikacji — możliwe braki danych."
                    ),
                    legal_basis=LEGAL_BASIS,
                    severity=Severity.HIGH,
                    start=week.week_start,
                    end=week.week_end,
                    actual_minutes=0,
                    limit_minutes=profile.weekly_rest_reduced_min,
                    excess_minutes=profile.weekly_rest_reduced_min,
                    evidence=(
                        EvidenceItem(
                            start=week.week_start,
                            end=week.week_end,
                            activity_type="WEEK",
                            duration_minutes=0,
                            note="no weekly rest detected in this week",
                        ),
                    ),
                    recommended_action=make_recommended_action("HIGH"),
                    automation=AutomationHint(
                        notify_transport_manager=True,
                        notify_driver=False,
                        create_case=True,
                    ),
                    extra={"requiresVerification": True},
                )
            )
            continue

        if candidate.minutes < profile.weekly_rest_reduced_min:
            sev = severity_for_short_weekly_rest(candidate.minutes)
            out.append(
                Violation(
                    driver_id=context.driver_id,
                    country_profile=profile.code,
                    rule_code=CODE_SHORT,
                    title="Wöchentliche Ruhezeit unter 24 Stunden",
                    title_de="Wöchentliche Ruhezeit unter 24 Stunden",
                    title_pl="Odpoczynek tygodniowy krótszy niż 24h",
                    description=(
                        f"Najdłuższy odpoczynek w tygodniu wyniósł "
                        f"{candidate.minutes} min, poniżej dopuszczalnego "
                        f"skróconego {profile.weekly_rest_reduced_min} min."
                    ),
                    legal_basis=LEGAL_BASIS,
                    severity=sev,
                    start=candidate.start,
                    end=candidate.end,
                    actual_minutes=candidate.minutes,
                    limit_minutes=profile.weekly_rest_reduced_min,
                    excess_minutes=profile.weekly_rest_reduced_min - candidate.minutes,
                    evidence=(
                        EvidenceItem(
                            start=candidate.start,
                            end=candidate.end,
                            activity_type="REST",
                            duration_minutes=candidate.minutes,
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
        elif candidate.minutes < profile.weekly_rest_regular_min:
            # Reduced weekly rest -> compensation required.
            out.append(
                Violation(
                    driver_id=context.driver_id,
                    country_profile=profile.code,
                    rule_code=CODE_REDUCED,
                    title="Reduzierte wöchentliche Ruhezeit (Ausgleich erforderlich)",
                    title_de="Reduzierte wöchentliche Ruhezeit (Ausgleich erforderlich)",
                    title_pl="Skrócony odpoczynek tygodniowy — wymaga rekompensaty",
                    description=(
                        f"Odpoczynek tygodniowy {candidate.minutes} min jest "
                        f"skrócony i wymaga rekompensaty w ciągu trzech "
                        f"kolejnych tygodni."
                    ),
                    legal_basis=LEGAL_BASIS,
                    severity=Severity.MEDIUM,
                    start=candidate.start,
                    end=candidate.end,
                    actual_minutes=candidate.minutes,
                    limit_minutes=profile.weekly_rest_regular_min,
                    excess_minutes=profile.weekly_rest_regular_min - candidate.minutes,
                    evidence=(
                        EvidenceItem(
                            start=candidate.start,
                            end=candidate.end,
                            activity_type="REST",
                            duration_minutes=candidate.minutes,
                            note="reduced weekly rest",
                        ),
                    ),
                    recommended_action=make_recommended_action("MEDIUM"),
                    automation=AutomationHint(
                        notify_transport_manager=True,
                        notify_driver=False,
                        create_case=False,
                    ),
                    # TODO: Track compensation across the next 3 transport
                    # weeks. The flag below is purely informational for now.
                    extra={"compensationRequired": True},
                )
            )

    return out
