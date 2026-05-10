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
from backend.compliance.adapters.shift_details_adapter import (
    from_shift_details,
    looks_like_analysis_result,
)

__all__ = [
    "from_parsed_ddd",
    "from_shift_details",
    "from_timeline",
    "looks_like_analysis_result",
    "map_activity_label",
]
