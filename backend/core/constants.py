"""
DDD domain constants.

Activity types per EU Regulation 3821/85, timezone references,
and parser field semantics.
"""

from zoneinfo import ZoneInfo

# ---------------------------------------------------------------------------
# Timezones
# ---------------------------------------------------------------------------

UTC = ZoneInfo('UTC')
CET = ZoneInfo('Europe/Berlin')

# ---------------------------------------------------------------------------
# DDD Activity types per EU Regulation 3821/85
# ---------------------------------------------------------------------------

REST = 0
AVAILABILITY = 1
WORK = 2
DRIVING = 3
UNKNOWN = -1  # Synthetic: no data available (gap between records, card absent with no entry)

STRICT_GLOBOFLEET_MODE = True

ACTIVITY_NAMES = {
    REST: 'REST',
    AVAILABILITY: 'AVAILABILITY',
    WORK: 'WORK',
    DRIVING: 'DRIVING',
    UNKNOWN: 'UNKNOWN',
}

# ---------------------------------------------------------------------------
# Tachograph-go activity string → DDD activity type mapping
# ---------------------------------------------------------------------------

TACHOGRAPH_GO_ACTIVITY_MAP = {
    'break/rest': REST,
    'availability': AVAILABILITY,
    'work': WORK,
    'driving': DRIVING,
}


# ---------------------------------------------------------------------------
# Helpers that depend only on constants
# ---------------------------------------------------------------------------

def _is_rest_like_for_shift_split(wt):
    """Check if work type should be treated as rest for shift splitting."""
    return wt in (REST, UNKNOWN)


def _is_break_like_for_reporting(wt):
    """Check if work type is a break for reporting purposes."""
    return wt == REST
