"""Tachograph compliance engine.

Public surface — see ``engine.ComplianceEngine`` and ``models``.

This package:
* operates on ``NormalizedActivity[]``,
* returns ``Violation[]`` decided by deterministic rules,
* does *not* know about Samsara, DDD parsing, or download deadlines.
"""

from backend.compliance.engine import (
    ComplianceEngine,
    DEFAULT_RULES,
    build_webhook_event,
)
from backend.compliance.models import (
    ActivitySource,
    ActivityType,
    ComplianceContext,
    ComplianceFacts,
    EvidenceItem,
    NormalizedActivity,
    Severity,
    Violation,
    ViolationStatus,
)
from backend.compliance.profiles import (
    DE_PROFILE,
    DE_REPORT_LABELS,
    EU_561_PROFILE,
    CountryProfile,
)
from backend.compliance.service import (
    build_webhook_events,
    evaluate_parser_analysis_for_violations,
    inspect_parser_analysis,
)

__all__ = [
    "ActivitySource",
    "ActivityType",
    "ComplianceContext",
    "ComplianceEngine",
    "ComplianceFacts",
    "CountryProfile",
    "DEFAULT_RULES",
    "DE_PROFILE",
    "DE_REPORT_LABELS",
    "EU_561_PROFILE",
    "EvidenceItem",
    "NormalizedActivity",
    "Severity",
    "Violation",
    "ViolationStatus",
    "build_webhook_event",
    "build_webhook_events",
    "evaluate_parser_analysis_for_violations",
    "inspect_parser_analysis",
]
