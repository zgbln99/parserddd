"""Domain models for the tachograph compliance engine.

This module is the wire format between the parser/normalizer layer and the
rule engine. It is intentionally framework-free: no Flask, no DB, no IO.

The compliance engine consumes ``NormalizedActivity`` and returns
``Violation`` objects. Everything else (facts, contexts) is internal to the
engine and lives here so rules and tests share one source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Activity types
# ---------------------------------------------------------------------------

class ActivityType(str, Enum):
    DRIVING = "DRIVING"
    WORK = "WORK"
    AVAILABILITY = "AVAILABILITY"
    BREAK = "BREAK"
    REST = "REST"
    UNKNOWN = "UNKNOWN"


class ActivitySource(str, Enum):
    DDD = "DDD"
    SAMSARA = "SAMSARA"
    MANUAL = "MANUAL"


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class NormalizedActivity:
    """One contiguous activity slice on a driver's timeline.

    ``start`` is inclusive, ``end`` is exclusive. Both must be timezone-aware.
    """

    driver_id: str
    type: ActivityType
    start: datetime
    end: datetime
    vehicle_id: Optional[str] = None
    source: Optional[ActivitySource] = None
    country: Optional[str] = None
    is_manual_entry: bool = False
    is_out_of_scope: bool = False
    is_ferry_train: bool = False
    is_multi_manning: bool = False
    raw_ref: Optional[str] = None

    def duration_minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

class Severity(str, Enum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ViolationStatus(str, Enum):
    NEW = "NEW"
    REVIEWED = "REVIEWED"
    EXPLAINED = "EXPLAINED"
    DRIVER_NOTIFIED = "DRIVER_NOTIFIED"
    TRAINING_REQUIRED = "TRAINING_REQUIRED"
    DISMISSED_FALSE_POSITIVE = "DISMISSED_FALSE_POSITIVE"


@dataclass(frozen=True)
class EvidenceItem:
    start: datetime
    end: datetime
    activity_type: Optional[str] = None
    duration_minutes: Optional[int] = None
    note: Optional[str] = None
    raw_ref: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "activityType": self.activity_type,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "durationMinutes": self.duration_minutes,
            "note": self.note,
            "rawRef": self.raw_ref,
        }


@dataclass(frozen=True)
class AutomationHint:
    notify_transport_manager: bool = False
    notify_driver: bool = False
    create_case: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "notifyTransportManager": self.notify_transport_manager,
            "notifyDriver": self.notify_driver,
            "createCase": self.create_case,
        }


@dataclass(frozen=True)
class Violation:
    driver_id: str
    rule_code: str
    title: str
    description: str
    legal_basis: str
    severity: Severity
    start: datetime
    end: datetime
    country_profile: str = "DE"
    vehicle_id: Optional[str] = None
    title_pl: Optional[str] = None
    title_de: Optional[str] = None
    actual_minutes: Optional[int] = None
    limit_minutes: Optional[int] = None
    excess_minutes: Optional[int] = None
    evidence: tuple[EvidenceItem, ...] = ()
    recommended_action: Optional[str] = None
    automation: Optional[AutomationHint] = None
    status: ViolationStatus = ViolationStatus.NEW
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def id(self) -> str:
        # Stable, content-addressable id. Sufficient for de-duplication and
        # log correlation; not a cryptographic identifier.
        return (
            f"{self.rule_code}:{self.driver_id}:"
            f"{self.start.isoformat()}:{self.end.isoformat()}"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "driverId": self.driver_id,
            "vehicleId": self.vehicle_id,
            "countryProfile": self.country_profile,
            "ruleCode": self.rule_code,
            "title": self.title,
            "titlePl": self.title_pl,
            "titleDe": self.title_de,
            "description": self.description,
            "legalBasis": self.legal_basis,
            "severity": self.severity.value,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "actualMinutes": self.actual_minutes,
            "limitMinutes": self.limit_minutes,
            "excessMinutes": self.excess_minutes,
            "evidence": [e.to_dict() for e in self.evidence],
            "recommendedAction": self.recommended_action,
            "automation": self.automation.to_dict() if self.automation else None,
            "status": self.status.value,
            "extra": dict(self.extra) if self.extra else {},
        }


# ---------------------------------------------------------------------------
# Facts (computed once per evaluation, shared across rules)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class BreakSegment:
    start: datetime
    end: datetime
    minutes: int


@dataclass(frozen=True)
class DrivingBlock:
    """A run of driving punctuated by short, sub-45-minute pauses.

    A ``DrivingBlock`` ends when either a single break >= 45 min, a valid
    15+30 split (in that order), or a >=45-min REST window is observed.
    """

    driver_id: str
    start: datetime
    end: datetime
    driving_minutes: int
    break_segments: tuple[BreakSegment, ...]
    activities: tuple[NormalizedActivity, ...]


@dataclass(frozen=True)
class DailyWorkPeriod:
    """A driver day from end-of-rest to next end-of-rest.

    For now this is approximated by calendar days when no rest framing is
    available; see ``facts.daily_work_periods``.
    """

    driver_id: str
    start: datetime
    end: datetime
    activities: tuple[NormalizedActivity, ...]
    is_calendar_day_fallback: bool = False


@dataclass(frozen=True)
class DailyDrivingSummary:
    driver_id: str
    period_start: datetime
    period_end: datetime
    driving_minutes: int
    is_extended_to_10h: bool


@dataclass(frozen=True)
class WeeklyDrivingSummary:
    driver_id: str
    week_start: datetime
    week_end: datetime
    driving_minutes: int
    daily_summaries: tuple[DailyDrivingSummary, ...]
    extended_days_count: int


@dataclass(frozen=True)
class FortnightlyDrivingSummary:
    driver_id: str
    week_start: datetime  # start of the first week of the pair
    week_end: datetime    # end of the second week of the pair
    driving_minutes: int


@dataclass(frozen=True)
class RestPeriod:
    """A continuous block of REST/BREAK >= some minimum (configurable).

    Whether a given rest counts as 'daily' or 'weekly' is decided by rules,
    not by the fact-builder.
    """

    driver_id: str
    start: datetime
    end: datetime
    minutes: int


@dataclass(frozen=True)
class DataGap:
    driver_id: str
    start: datetime
    end: datetime
    minutes: int
    kind: str  # "UNKNOWN" or "MISSING"


@dataclass(frozen=True)
class ComplianceFacts:
    driving_blocks: tuple[DrivingBlock, ...]
    daily_work_periods: tuple[DailyWorkPeriod, ...]
    daily_driving_summaries: tuple[DailyDrivingSummary, ...]
    weekly_driving_summaries: tuple[WeeklyDrivingSummary, ...]
    fortnightly_driving_summaries: tuple[FortnightlyDrivingSummary, ...]
    rest_periods: tuple[RestPeriod, ...]
    data_gaps: tuple[DataGap, ...]


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ComplianceContext:
    driver_id: str
    activities: tuple[NormalizedActivity, ...]
    facts: ComplianceFacts
    profile: "CountryProfile"
    timezone: str = "Europe/Berlin"
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None


# Forward reference resolved at import time.
from backend.compliance.profiles.base import CountryProfile  # noqa: E402
