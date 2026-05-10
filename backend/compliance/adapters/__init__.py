"""Adapters from the existing parser/analysis layer to compliance models.

This package converts the existing parser output (UTC-aware timeline tuples
of ``(start_dt, end_dt, work_type, card_out)`` plus driver/vehicle metadata)
into ``NormalizedActivity[]`` for the compliance engine. **It never mutates
the inputs and never recomputes hours.**
"""

from backend.compliance.adapters.parser_analysis_adapter import (
    from_parsed_ddd,
    from_timeline,
    map_activity_label,
)

__all__ = [
    "from_parsed_ddd",
    "from_timeline",
    "map_activity_label",
]
