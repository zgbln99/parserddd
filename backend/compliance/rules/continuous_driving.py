"""EU 561 Art. 7 — continuous-driving (4h30) rule."""

from __future__ import annotations

from backend.compliance.models import (
    AutomationHint,
    ComplianceContext,
    EvidenceItem,
    Severity,
    Violation,
)
from backend.compliance.rules._base import make_recommended_action
from backend.compliance.severity import severity_for_continuous_driving_excess


CODE = "EU_561_CONTINUOUS_DRIVING"
LEGAL_BASIS = "Art. 7 VO (EG) Nr. 561/2006"


def evaluate(context: ComplianceContext) -> list[Violation]:
    profile = context.profile
    limit = profile.continuous_driving_limit_min
    out: list[Violation] = []

    for block in context.facts.driving_blocks:
        if block.driver_id != context.driver_id:
            continue
        if block.driving_minutes <= limit:
            continue

        excess = block.driving_minutes - limit
        sev = severity_for_continuous_driving_excess(excess)

        evidence = [
            EvidenceItem(
                start=a.start,
                end=a.end,
                activity_type=a.type.value,
                duration_minutes=a.duration_minutes(),
                raw_ref=a.raw_ref,
            )
            for a in block.activities
        ]
        for seg in block.break_segments:
            evidence.append(
                EvidenceItem(
                    start=seg.start,
                    end=seg.end,
                    activity_type="BREAK",
                    duration_minutes=seg.minutes,
                    note="break segment within driving block",
                )
            )

        description = (
            f"Kierowca prowadził pojazd przez {block.driving_minutes} minut "
            f"bez wymaganej przerwy {profile.required_break_min} minut lub "
            f"prawidłowej przerwy dzielonej "
            f"{profile.split_break_first_min}+{profile.split_break_second_min}."
        )

        automation = AutomationHint(
            notify_transport_manager=sev in (Severity.HIGH, Severity.CRITICAL),
            notify_driver=True,
            create_case=sev in (Severity.HIGH, Severity.CRITICAL),
        )

        out.append(
            Violation(
                driver_id=block.driver_id,
                vehicle_id=_vehicle_id_for_block(block),
                country_profile=profile.code,
                rule_code=CODE,
                title="Lenkzeit ohne ausreichende Fahrtunterbrechung überschritten",
                title_de="Lenkzeit ohne ausreichende Fahrtunterbrechung überschritten",
                title_pl="Przekroczony czas jazdy bez wymaganej przerwy",
                description=description,
                legal_basis=LEGAL_BASIS,
                severity=sev,
                start=block.start,
                end=block.end,
                actual_minutes=block.driving_minutes,
                limit_minutes=limit,
                excess_minutes=excess,
                evidence=tuple(evidence),
                recommended_action=make_recommended_action(sev.value),
                automation=automation,
            )
        )

    return out


def _vehicle_id_for_block(block) -> str | None:
    for a in block.activities:
        if a.vehicle_id:
            return a.vehicle_id
    return None
