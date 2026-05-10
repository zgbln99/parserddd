"""Fact builders consumed by rules.

Each builder is pure: same input -> same output. Rules never recompute
facts; the engine builds them once and threads them through the context.
"""

from backend.compliance.facts.daily_work_periods import build_daily_work_periods
from backend.compliance.facts.data_gaps import build_data_gaps
from backend.compliance.facts.driving_blocks import build_driving_blocks
from backend.compliance.facts.rest_periods import build_rest_periods
from backend.compliance.facts.week_summaries import (
    build_daily_driving_summaries,
    build_fortnightly_driving_summaries,
    build_weekly_driving_summaries,
)

__all__ = [
    "build_daily_work_periods",
    "build_daily_driving_summaries",
    "build_data_gaps",
    "build_driving_blocks",
    "build_fortnightly_driving_summaries",
    "build_rest_periods",
    "build_weekly_driving_summaries",
]
