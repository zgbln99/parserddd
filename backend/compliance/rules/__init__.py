"""Rule registry.

Each rule is a module exporting ``CODE``, ``LEGAL_BASIS`` and
``evaluate(context)``. The engine doesn't import these directly — see
``engine.DEFAULT_RULES``.
"""

from backend.compliance.rules import (
    continuous_driving,
    daily_driving,
    daily_rest,
    fortnightly_driving,
    mindestlohn,
    missing_card_or_data_gap,
    weekly_driving,
    weekly_rest,
)

__all__ = [
    "continuous_driving",
    "daily_driving",
    "daily_rest",
    "fortnightly_driving",
    "mindestlohn",
    "missing_card_or_data_gap",
    "weekly_driving",
    "weekly_rest",
]
