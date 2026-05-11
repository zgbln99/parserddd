"""MiLoG — German statutory minimum wage check.

Compares a driver's effective hourly gross — monthly gross divided by the
hours actually worked in the period — against the statutory floor (14 €/h
by default). The gross figure comes from the engine's :class:`WageConfig`:
a company-wide default that can be overridden per driver with the real
amount. Hours worked = driving + other work + availability, taken straight
from the tachograph data, so no per-driver hourly rate has to be entered.

The check only runs over whole calendar months (one or more). When the
evaluated window isn't month-aligned the rule stays silent rather than
prorating a partial salary and risking a false positive.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from backend.compliance.models import (
    AutomationHint,
    ComplianceContext,
    EvidenceItem,
    Violation,
)
from backend.compliance.severity import severity_for_wage_shortfall


CODE = "DE_MILOG_MINDESTLOHN"
LEGAL_BASIS = "§ 1, § 20 MiLoG"

# Tolerance on €/h comparisons so a rounding artefact (13.9998 €/h) doesn't
# trip the rule.
_EPSILON_EUR_PER_H = 0.005


def evaluate(context: ComplianceContext) -> list[Violation]:
    cfg = context.wage_config
    if cfg is None or cfg.min_hourly_eur <= 0:
        return []

    gross_monthly = cfg.monthly_gross_for(context.driver_id)
    if gross_monthly <= 0:
        # No real figure for this driver and no company default → nothing
        # to compare against.
        return []

    counted = [
        a for a in context.activities
        if a.type in cfg.counted_activity_types and not a.is_out_of_scope
    ]
    if not counted:
        return []

    window_start = cfg.period_start or context.period_start or min(a.start for a in counted)
    window_end = cfg.period_end or context.period_end or max(a.end for a in counted)
    months = _whole_months(window_start, window_end)
    if months is None:
        return []

    minutes_by_type: dict[str, int] = {}
    total_minutes = 0
    for a in counted:
        s = max(a.start, window_start)
        e = min(a.end, window_end)
        if e <= s:
            continue
        m = int((e - s).total_seconds() // 60)
        if m <= 0:
            continue
        minutes_by_type[a.type.value] = minutes_by_type.get(a.type.value, 0) + m
        total_minutes += m
    if total_minutes <= 0:
        return []

    worked_hours = total_minutes / 60.0
    gross_for_window = gross_monthly * months
    effective_hourly = gross_for_window / worked_hours
    if effective_hourly >= cfg.min_hourly_eur - _EPSILON_EUR_PER_H:
        return []

    required_gross = cfg.min_hourly_eur * worked_hours
    shortfall = required_gross - gross_for_window
    sev = severity_for_wage_shortfall(effective_hourly, cfg.min_hourly_eur)
    source = "driver" if cfg.has_override(context.driver_id) else "default"

    evidence = tuple(
        EvidenceItem(
            start=window_start,
            end=window_end,
            activity_type=t,
            duration_minutes=mins,
            note="counted as working time",
        )
        for t, mins in sorted(minutes_by_type.items())
    )

    profile = context.profile
    return [
        Violation(
            driver_id=context.driver_id,
            country_profile=profile.code,
            rule_code=CODE,
            title="Mindestlohn unterschritten",
            title_de="Mindestlohn unterschritten",
            title_pl="Stawka poniżej płacy minimalnej",
            description=(
                f"Efektywna stawka {effective_hourly:.2f} €/h "
                f"(brutto {gross_for_window:.2f} € / {worked_hours:.1f} h pracy: "
                f"jazda + inna praca + dyspozycyjność) jest poniżej progu "
                f"{cfg.min_hourly_eur:.2f} €/h. Do osiągnięcia minimum brakuje "
                f"{shortfall:.2f} € brutto."
            ),
            legal_basis=LEGAL_BASIS,
            severity=sev,
            start=window_start,
            end=window_end,
            actual_minutes=total_minutes,
            limit_minutes=None,
            excess_minutes=None,
            evidence=evidence,
            recommended_action=(
                "Zweryfikować rozliczenie wynagrodzenia brutto za okres i "
                "wyrównać brakującą kwotę do progu płacy minimalnej; uzupełnić "
                "rzeczywistą stawkę kierowcy w konfiguracji, jeśli odbiega od "
                "wartości domyślnej."
            ),
            automation=AutomationHint(
                notify_transport_manager=True,
                notify_driver=False,
                create_case=True,
            ),
            extra={
                "workedHours": round(worked_hours, 2),
                "workedMinutesByType": minutes_by_type,
                "monthsInPeriod": months,
                "grossMonthlyEur": round(gross_monthly, 2),
                "grossForPeriodEur": round(gross_for_window, 2),
                "effectiveHourlyEur": round(effective_hourly, 4),
                "minHourlyEur": cfg.min_hourly_eur,
                "requiredGrossEur": round(required_gross, 2),
                "shortfallEur": round(shortfall, 2),
                "grossSource": source,
            },
        )
    ]


def _whole_months(start: datetime, end: datetime) -> Optional[int]:
    """Number of whole calendar months in ``[start, end)``.

    Returns ``None`` when the window doesn't start and end exactly on a
    month boundary (so the monthly gross can't be attributed cleanly).
    """
    if start is None or end is None or end <= start:
        return None
    if not (_is_month_start(start) and _is_month_start(end)):
        return None
    months = (end.year - start.year) * 12 + (end.month - start.month)
    return months if months > 0 else None


def _is_month_start(dt: datetime) -> bool:
    return (
        dt.day == 1
        and dt.hour == 0
        and dt.minute == 0
        and dt.second == 0
        and dt.microsecond == 0
    )
