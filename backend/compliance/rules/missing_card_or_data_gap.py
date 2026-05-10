"""EU 165/2014 — missing-card / data-gap warnings.

We deliberately do not assert that a gap *is* driving without a card; the
data is by definition incomplete. We raise a warning that requires
verification.
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
from backend.compliance.severity import severity_for_data_gap


CODE = "EU_165_MISSING_CARD_OR_DATA_GAP"
LEGAL_BASIS = "Art. 34 VO (EU) Nr. 165/2014"


def evaluate(context: ComplianceContext) -> list[Violation]:
    profile = context.profile
    out: list[Violation] = []

    threshold = profile.data_gap_warn_min
    high_threshold = profile.data_gap_high_min

    for gap in context.facts.data_gaps:
        if gap.driver_id != context.driver_id:
            continue
        if gap.minutes < threshold:
            continue

        sev = severity_for_data_gap(gap.minutes, threshold_high=high_threshold)
        kind_pl = "nieznane aktywności" if gap.kind == "UNKNOWN" else "luka w danych"

        out.append(
            Violation(
                driver_id=gap.driver_id,
                country_profile=profile.code,
                rule_code=CODE,
                title="Datenlücke / fehlende Kartendaten",
                title_de="Datenlücke / fehlende Kartendaten",
                title_pl="Luka w danych / możliwe braki karty kierowcy",
                description=(
                    f"Wykryto {kind_pl} trwające {gap.minutes} min. "
                    f"Brak danych uniemożliwia pełną ocenę — wymaga weryfikacji "
                    f"(potencjalna jazda bez karty)."
                ),
                legal_basis=LEGAL_BASIS,
                severity=sev,
                start=gap.start,
                end=gap.end,
                actual_minutes=gap.minutes,
                limit_minutes=threshold,
                excess_minutes=gap.minutes - threshold,
                evidence=(
                    EvidenceItem(
                        start=gap.start,
                        end=gap.end,
                        activity_type=gap.kind,
                        duration_minutes=gap.minutes,
                        note="data gap requires verification",
                    ),
                ),
                recommended_action=(
                    "Zweryfikować, czy kierowca pracował w tym czasie. "
                    "Jeżeli tak — uzupełnić wpis ręczny i ponownie ocenić."
                ),
                automation=AutomationHint(
                    notify_transport_manager=True,
                    notify_driver=False,
                    create_case=sev == Severity.HIGH,
                ),
                extra={"requiresVerification": True},
            )
        )

    return out
