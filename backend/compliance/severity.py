"""Severity helpers used by rules.

Rules pick severity from the size of the breach. We keep the thresholds
here (minutes only) so they can be tuned in one place.
"""

from __future__ import annotations

from backend.compliance.models import Severity


def severity_for_continuous_driving_excess(excess_minutes: int) -> Severity:
    """Severity scale for >4h30 continuous-driving breaches."""
    if excess_minutes <= 0:
        return Severity.INFO
    if excess_minutes <= 15:
        return Severity.MEDIUM
    if excess_minutes <= 30:
        return Severity.HIGH
    return Severity.CRITICAL


def severity_for_daily_driving_excess(excess_minutes: int) -> Severity:
    """Severity scale for >10h daily-driving breaches.

    The legal limit is 9h (extendable twice a week to 10h). We grade only the
    excess over the hard 10h ceiling.
    """
    if excess_minutes <= 0:
        return Severity.INFO
    if excess_minutes <= 30:
        return Severity.MEDIUM
    if excess_minutes <= 60:
        return Severity.HIGH
    return Severity.CRITICAL


def severity_for_weekly_driving_excess(excess_minutes: int) -> Severity:
    if excess_minutes <= 0:
        return Severity.INFO
    if excess_minutes <= 60:
        return Severity.MEDIUM
    if excess_minutes <= 180:
        return Severity.HIGH
    return Severity.CRITICAL


def severity_for_fortnightly_driving_excess(excess_minutes: int) -> Severity:
    if excess_minutes <= 0:
        return Severity.INFO
    if excess_minutes <= 120:
        return Severity.MEDIUM
    if excess_minutes <= 300:
        return Severity.HIGH
    return Severity.CRITICAL


def severity_for_short_daily_rest(actual_minutes: int) -> Severity:
    """For rests below the reduced 9h floor."""
    if actual_minutes >= 540:
        return Severity.INFO
    deficit = 540 - actual_minutes
    if deficit <= 60:
        return Severity.HIGH
    return Severity.CRITICAL


def severity_for_short_weekly_rest(actual_minutes: int) -> Severity:
    """For weekly rests under the 24h floor."""
    if actual_minutes >= 1440:
        return Severity.INFO
    deficit = 1440 - actual_minutes
    if deficit <= 120:
        return Severity.HIGH
    return Severity.CRITICAL


def severity_for_data_gap(minutes: int, threshold_high: int = 240) -> Severity:
    """Data gaps are warnings, not hard violations.

    Above ``threshold_high`` minutes we escalate from MEDIUM to HIGH so a
    transport manager actually looks at it.
    """
    if minutes >= threshold_high:
        return Severity.HIGH
    return Severity.MEDIUM
