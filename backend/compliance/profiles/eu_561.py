"""Default EU 561 profile.

Used as a baseline; jurisdiction-specific profiles inherit these numbers
unless they need to override them.
"""

from __future__ import annotations

from backend.compliance.profiles.base import CountryProfile


EU_561_PROFILE = CountryProfile(
    code="EU",
    locale="en",
    currency="EUR",
    enforcement_authority="EU",
    timezone="UTC",
)
