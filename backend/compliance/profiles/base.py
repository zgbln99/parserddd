"""Country profile abstraction.

A profile holds the tunable parameters and reporting metadata that vary by
jurisdiction. Rule logic stays in ``rules/``; profiles only carry numbers
and strings.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CountryProfile:
    code: str                   # ISO-like code, e.g. "DE"
    locale: str                 # e.g. "de-DE"
    currency: str               # e.g. "EUR"
    enforcement_authority: str  # e.g. "BALM"
    timezone: str               # e.g. "Europe/Berlin"

    # ---- EU 561 driving-time limits (minutes) ----
    continuous_driving_limit_min: int = 270         # 4h30
    required_break_min: int = 45
    split_break_first_min: int = 15
    split_break_second_min: int = 30
    daily_driving_normal_min: int = 540             # 9h
    daily_driving_extended_min: int = 600           # 10h
    weekly_extensions_allowed: int = 2
    weekly_driving_limit_min: int = 3360            # 56h
    fortnightly_driving_limit_min: int = 5400       # 90h

    # ---- EU 561 rest limits (minutes) ----
    daily_rest_regular_min: int = 660               # 11h
    daily_rest_reduced_min: int = 540               # 9h
    daily_rest_split_first_min: int = 180           # 3h
    daily_rest_split_second_min: int = 540          # 9h
    reduced_daily_rests_per_week: int = 3
    weekly_rest_regular_min: int = 2700             # 45h
    weekly_rest_reduced_min: int = 1440             # 24h

    # ---- Data-gap thresholds (minutes) ----
    data_gap_warn_min: int = 30
    data_gap_high_min: int = 240
