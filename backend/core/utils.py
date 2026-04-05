"""
Utility functions — date parsing, time formatting, geo calculations.

Pure Python, no Flask dependency.
"""

import math
from datetime import datetime

from .constants import UTC, CET


def parse_date_safe(date_str):
    """Parse date string (YYYY-MM-DD) safely, returning None on failure."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def minutes_to_hm(minutes):
    """Convert integer minutes to H:MM string."""
    h = minutes // 60
    m = minutes % 60
    return f"{h}:{m:02d}"


def minutes_to_decimal(minutes):
    """Convert integer minutes to decimal hours (rounded to 2 dp)."""
    return round(minutes / 60, 2)


def _haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance in km between two GPS points using Haversine formula."""
    R = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _to_cet(dt):
    """Convert a UTC-aware datetime to CET for display purposes."""
    return dt.astimezone(CET)


def _sanitize_text(val: str, max_len: int = 200) -> str:
    """Strip and limit text input length."""
    return str(val).strip()[:max_len]
