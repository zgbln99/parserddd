"""Common base for compliance rules.

Rules are kept tiny and composable on purpose. The engine treats them as
a list of pure functions; nothing prevents adding more rules outside the
package.
"""

from __future__ import annotations

from typing import Protocol

from backend.compliance.models import ComplianceContext, Violation


class ComplianceRule(Protocol):
    code: str
    legal_basis: str

    def evaluate(self, context: ComplianceContext) -> list[Violation]:
        ...


def make_recommended_action(severity_value: str) -> str:
    """A neutral default action suggestion based on severity."""
    if severity_value in ("CRITICAL", "HIGH"):
        return (
            "Niezwłoczna weryfikacja przez dyspozytora, rozmowa "
            "instruktażowa z kierowcą, oznaczenie naruszenia jako "
            "EXPLAINED dopiero po analizie."
        )
    if severity_value == "MEDIUM":
        return (
            "Zweryfikować przebieg dnia, poinformować kierowcę i oznaczyć "
            "naruszenie jako wyjaśnione po analizie dyspozytora."
        )
    return "Do przeglądu przy najbliższej rutynowej kontroli."
