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
from typing import Any, Mapping, Optional


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
class Coverage:
    """How much wall-clock data the analysis window actually covers.

    Used by rules whose verdict depends on having enough surrounding
    context — for example, a "missing weekly rest" claim is only safe
    when we have at least a full transport week of data to look at.
    """
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    minutes: int = 0

    @property
    def days(self) -> float:
        return self.minutes / 1440.0 if self.minutes else 0.0

    @property
    def sufficient_for_weekly_rules(self) -> bool:
        # 7 days of span is the minimum at which we can claim a weekly
        # rest is "missing"; anything shorter is just an incomplete
        # snapshot, not an offence.
        return self.days >= 7.0

    @property
    def sufficient_for_fortnightly_rules(self) -> bool:
        return self.days >= 14.0


@dataclass(frozen=True)
class ComplianceFacts:
    driving_blocks: tuple[DrivingBlock, ...]
    daily_work_periods: tuple[DailyWorkPeriod, ...]
    daily_driving_summaries: tuple[DailyDrivingSummary, ...]
    weekly_driving_summaries: tuple[WeeklyDrivingSummary, ...]
    fortnightly_driving_summaries: tuple[FortnightlyDrivingSummary, ...]
    rest_periods: tuple[RestPeriod, ...]
    data_gaps: tuple[DataGap, ...]
    coverage: Coverage = Coverage()


# ---------------------------------------------------------------------------
# Wage / minimum-wage configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class WageConfig:
    """Parameters for the German statutory minimum-wage (MiLoG) check.

    ``default_monthly_gross_eur`` is the company-wide assumed monthly gross
    salary; ``per_driver_monthly_gross_eur`` overrides it for individual
    drivers with their real figure. A value of 0 (or absence) means
    "unknown" — the rule then skips that driver rather than guessing.

    ``period_start`` / ``period_end`` describe the window the monthly gross
    applies to. The check is only meaningful over whole calendar months, so
    the rule evaluates only when this window spans an exact number of them.

    ``counted_activity_types`` is what counts as paid working time for the
    €/h divisor — driving + other work + availability by default.
    """

    min_hourly_eur: float = 14.0
    default_monthly_gross_eur: float = 0.0
    per_driver_monthly_gross_eur: Mapping[str, float] = field(default_factory=dict)
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    counted_activity_types: tuple[ActivityType, ...] = (
        ActivityType.DRIVING,
        ActivityType.WORK,
        ActivityType.AVAILABILITY,
    )

    def monthly_gross_for(self, driver_id: str) -> float:
        """Resolved monthly gross for a driver (override → default → 0)."""
        v = self.per_driver_monthly_gross_eur.get(driver_id)
        if v is not None:
            try:
                v = float(v)
            except (TypeError, ValueError):
                v = 0.0
            if v > 0:
                return v
        try:
            return float(self.default_monthly_gross_eur or 0.0)
        except (TypeError, ValueError):
            return 0.0

    def has_override(self, driver_id: str) -> bool:
        v = self.per_driver_monthly_gross_eur.get(driver_id)
        try:
            return v is not None and float(v) > 0
        except (TypeError, ValueError):
            return False


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
    wage_config: Optional[WageConfig] = None


# Forward reference resolved at import time.
from backend.compliance.profiles.base import CountryProfile  # noqa: E402
