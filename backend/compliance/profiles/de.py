"""German (BALM) country profile.

EU 561 limits are identical to the base profile — we only customise locale,
authority and reporting strings. Mandate amounts are intentionally omitted
on this iteration; severity carries the risk signal.
"""

from __future__ import annotations

from backend.compliance.profiles.base import CountryProfile


DE_PROFILE = CountryProfile(
    code="DE",
    locale="de-DE",
    currency="EUR",
    enforcement_authority="BALM",
    timezone="Europe/Berlin",
)


# German report-field labels (Bewertungsbogen).
DE_REPORT_LABELS = {
    "driver": "Fahrer",
    "period": "Zeitraum",
    "violation": "Verstoß",
    "legal_basis": "Rechtsgrundlage",
    "start": "Beginn",
    "end": "Ende",
    "actual": "Ist-Wert",
    "limit": "Grenzwert",
    "excess": "Überschreitung",
    "severity": "Bewertung",
    "action": "Maßnahme",
    "status": "Status",
}
