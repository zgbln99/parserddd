"""EU 561 Art. 8 — daily rest.

A daily rest is the gap between two periods of duty. We approximate it
here by looking at REST/BREAK runs (``RestPeriod``) sized 6h..18h:
* >= 11h (660 min) — regular daily rest, no violation,
* 9h..<11h — reduced daily rest, allowed up to 3 times between weekly rests,
* < 9h — short daily rest (violation).

Splits (3h + 9h) are recognised when consecutive rests separated only by
non-DRIVING activity satisfy the order. We do not yet require the second
leg to start within 24h of duty start; this is marked TODO.

TODO: True legal definition counts daily-rest windows from the end of the
previous daily/weekly rest. Implement once rest-to-rest framing exists.
"""

from __future__ import annotations

from datetime import timedelta

from backend.compliance.models import (
    AutomationHint,
    ComplianceContext,
    EvidenceItem,
    Severity,
    Violation,
)
from backend.compliance.rules._base import make_recommended_action
from backend.compliance.severity import severity_for_short_daily_rest


CODE_SHORT = "EU_561_DAILY_REST_SHORT"
CODE_REDUCED_LIMIT = "EU_561_DAILY_REST_TOO_MANY_REDUCED"
LEGAL_BASIS = "Art. 8 VO (EG) Nr. 561/2006"


def evaluate(context: ComplianceContext) -> list[Violation]:
    profile = context.profile
    out: list[Violation] = []

    rests = [
        r for r in context.facts.rest_periods if r.driver_id == context.driver_id
    ]
    rests.sort(key=lambda r: r.start)

    # Pre-compute split-rest pairings: a 3h+ rest followed (within 24h, no
    # daily/weekly rest in between) by a 9h+ rest counts as one split rest.
    split_indices: set[int] = set()
    for i, a in enumerate(rests):
        if a.minutes < profile.daily_rest_split_first_min:
            continue
        if a.minutes >= profile.daily_rest_reduced_min:
            continue  # already counts on its own
        for j in range(i + 1, len(rests)):
            b = rests[j]
            if b.start - a.end > timedelta(hours=24):
                break
            if b.minutes >= profile.daily_rest_split_second_min:
                split_indices.add(i)
                split_indices.add(j)
                break

    reduced_count = 0

    candidate_floor = profile.daily_rest_candidate_floor_min

    for idx, r in enumerate(rests):
        # In-shift pauses (coffee breaks, sub-4h rests) are not daily-rest
        # *attempts*. Without this guard, a 7-minute pause between two
        # driving segments would be reported as "rest 7 min < required
        # 540 min" — a meaningless alarm. EU 561 frames daily rest as a
        # continuous window of at least 9h between duty periods; we
        # require the rest to be at least 4h before considering it a
        # candidate for the daily-rest rule.
        if r.minutes < candidate_floor:
            continue

        # 1) Hard breach: rest below the 9h floor.
        if r.minutes < profile.daily_rest_reduced_min and idx not in split_indices:
            sev = severity_for_short_daily_rest(r.minutes)
            out.append(
                Violation(
                    driver_id=r.driver_id,
                    country_profile=profile.code,
                    rule_code=CODE_SHORT,
                    title="Tägliche Ruhezeit zu kurz",
                    title_de="Tägliche Ruhezeit zu kurz",
                    title_pl="Zbyt krótki dzienny odpoczynek",
                    description=(
                        f"Dzienny odpoczynek {r.minutes} min jest krótszy "
                        f"niż dopuszczalny skrócony "
                        f"{profile.daily_rest_reduced_min} min."
                    ),
                    legal_basis=LEGAL_BASIS,
                    severity=sev,
                    start=r.start,
                    end=r.end,
                    actual_minutes=r.minutes,
                    limit_minutes=profile.daily_rest_reduced_min,
                    excess_minutes=profile.daily_rest_reduced_min - r.minutes,
                    evidence=(
                        EvidenceItem(
                            start=r.start,
                            end=r.end,
                            activity_type="REST",
                            duration_minutes=r.minutes,
                        ),
                    ),
                    recommended_action=make_recommended_action(sev.value),
                    automation=AutomationHint(
                        notify_transport_manager=True,
                        notify_driver=True,
                        create_case=sev in (Severity.HIGH, Severity.CRITICAL),
                    ),
                )
            )
            continue

        # 2) Counting reduced rests between weekly rests.
        if r.minutes >= profile.weekly_rest_reduced_min:
            # Likely a weekly rest -> resets the reduced-rest counter.
            reduced_count = 0
            continue

        if profile.daily_rest_reduced_min <= r.minutes < profile.daily_rest_regular_min:
            reduced_count += 1
            if reduced_count > profile.reduced_daily_rests_per_week:
                # The "too many reduced rests between weekly rests" cap
                # only holds across a full inter-weekly-rest span. Without
                # at least a week of coverage we can't be sure the count
                # reflects a real over-use; skip rather than misreport.
                # TODO: replace this with a proper rest-to-rest framing
                # once available.
                if not context.facts.coverage.sufficient_for_weekly_rules:
                    continue
                out.append(
                    Violation(
                        driver_id=r.driver_id,
                        country_profile=profile.code,
                        rule_code=CODE_REDUCED_LIMIT,
                        title="Zu viele reduzierte tägliche Ruhezeiten",
                        title_de="Zu viele reduzierte tägliche Ruhezeiten",
                        title_pl="Zbyt wiele skróconych dziennych odpoczynków",
                        description=(
                            f"Liczba skróconych dziennych odpoczynków pomiędzy "
                            f"odpoczynkami tygodniowymi przekroczyła dopuszczalne "
                            f"{profile.reduced_daily_rests_per_week}."
                        ),
                        legal_basis=LEGAL_BASIS,
                        severity=Severity.HIGH,
                        start=r.start,
                        end=r.end,
                        actual_minutes=reduced_count,
                        limit_minutes=profile.reduced_daily_rests_per_week,
                        excess_minutes=reduced_count - profile.reduced_daily_rests_per_week,
                        evidence=(
                            EvidenceItem(
                                start=r.start,
                                end=r.end,
                                activity_type="REST",
                                duration_minutes=r.minutes,
                                note="reduced daily rest above allowance",
                            ),
                        ),
                        recommended_action=make_recommended_action("HIGH"),
                        automation=AutomationHint(
                            notify_transport_manager=True,
                            notify_driver=True,
                            create_case=True,
                        ),
                    )
                )

    return out
