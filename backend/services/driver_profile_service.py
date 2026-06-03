"""Public, password-gated driver profiles.

A driver profile is a stable public URL (``/profil/<token>``) that a single
driver opens to review ONLY their own data: a table of shifts ("zmiany")
plus diets ("diety") for a chosen month. Nothing else is exposed.

Access model (decided with the operator):
    - One **stable** link per driver — the admin shares it once.
    - The link is gated by a **password** the admin sets/resets in the
      admin panel for that driver.
    - After the driver types the password we hand out a short-lived signed
      access token (itsdangerous) so month-switching doesn't re-send the
      password and the heavy data endpoint can't be brute-forced.

Security:
    - ``token`` is 24 random bytes, base64url (~192 bits) — the secret part
      of the URL.
    - Passwords are stored hashed (bcrypt if available, SHA256 fallback —
      same helpers the rest of the app uses).
    - The post-login access token is an itsdangerous signature over the
      profile token, salted + TTL-bound; it is NOT a Flask session.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Mapping

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from config import FlaskConfig
from database import get_db
from auth.helpers import _hash_password, _verify_password


# Access token: 6h is comfortable for a driver checking a few months, short
# enough that a leaked token from a shared device stops working same-day.
ACCESS_TOKEN_TTL_SECONDS = 6 * 3600
_ACCESS_SALT = "driver-profile-access-v1"


class ProfileError(RuntimeError):
    """Raised on any profile-flow failure that maps to a 4xx response."""

    def __init__(self, message: str, *, status: int = 400):
        super().__init__(message)
        self.status = status


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(FlaskConfig.SECRET_KEY, salt=_ACCESS_SALT)


def _row_to_dict(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "card_number": row["card_number"],
        "driver_name": row["driver_name"],
        "token": row["token"],
        "password_hash": row["password_hash"],
        "enabled": bool(row["enabled"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "last_access": row["last_access"],
    }


# ---------------------------------------------------------------------------
# Admin-side CRUD
# ---------------------------------------------------------------------------


def create_or_update_profile(
    *,
    card_number: str,
    driver_name: str = "",
    password: str | None = None,
) -> dict[str, Any]:
    """Create a profile for a driver, or update name/password if it exists.

    A token is generated only on first creation so the shareable link stays
    stable across password resets.
    """
    card_number = (card_number or "").strip()
    if not card_number:
        raise ProfileError("card_number is required")

    existing = get_by_card(card_number)
    now = _now_iso()

    if existing:
        sets = ["driver_name = ?", "updated_at = ?", "enabled = 1"]
        params: list[Any] = [driver_name or existing["driver_name"], now]
        if password:
            sets.append("password_hash = ?")
            params.append(_hash_password(password))
        params.append(card_number)
        with get_db() as db:
            db.execute(
                f"UPDATE driver_profiles SET {', '.join(sets)} WHERE card_number = ?",
                tuple(params),
            )
            db.commit()
        return get_by_card(card_number)  # type: ignore[return-value]

    if not password:
        raise ProfileError("password is required for a new profile")

    token = secrets.token_urlsafe(24)
    with get_db() as db:
        db.execute(
            """
            INSERT INTO driver_profiles
            (card_number, driver_name, token, password_hash, enabled,
             created_at, updated_at, last_access)
            VALUES (?, ?, ?, ?, 1, ?, ?, '')
            """,
            (card_number, driver_name or "", token, _hash_password(password), now, now),
        )
        db.commit()
    return get_by_card(card_number)  # type: ignore[return-value]


def set_password(card_number: str, password: str) -> None:
    if not password:
        raise ProfileError("password is required")
    if not get_by_card(card_number):
        raise ProfileError("profile not found", status=404)
    with get_db() as db:
        db.execute(
            "UPDATE driver_profiles SET password_hash = ?, updated_at = ? WHERE card_number = ?",
            (_hash_password(password), _now_iso(), card_number),
        )
        db.commit()


def set_enabled(card_number: str, enabled: bool) -> None:
    if not get_by_card(card_number):
        raise ProfileError("profile not found", status=404)
    with get_db() as db:
        db.execute(
            "UPDATE driver_profiles SET enabled = ?, updated_at = ? WHERE card_number = ?",
            (1 if enabled else 0, _now_iso(), card_number),
        )
        db.commit()


def delete_profile(card_number: str) -> None:
    with get_db() as db:
        db.execute("DELETE FROM driver_profiles WHERE card_number = ?", (card_number,))
        db.commit()


def list_profiles() -> list[dict[str, Any]]:
    """Admin listing — JSON-safe (no password hash)."""
    with get_db() as db:
        rows = db.execute(
            """
            SELECT card_number, driver_name, token, password_hash, enabled,
                   created_at, updated_at, last_access
            FROM driver_profiles
            ORDER BY LOWER(driver_name), card_number
            """
        ).fetchall()
    out = []
    for r in rows:
        d = _row_to_dict(r)
        out.append(
            {
                "card_number": d["card_number"],
                "driver_name": d["driver_name"],
                "token": d["token"],
                "enabled": d["enabled"],
                "has_password": bool(d["password_hash"]),
                "created_at": d["created_at"],
                "updated_at": d["updated_at"],
                "last_access": d["last_access"],
            }
        )
    return out


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


def get_by_card(card_number: str) -> dict[str, Any] | None:
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM driver_profiles WHERE card_number = ?", (card_number,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def get_by_token(token: str) -> dict[str, Any] | None:
    if not token or len(token) > 128:
        return None
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM driver_profiles WHERE token = ?", (token,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def verify_password(profile: Mapping[str, Any], password: str) -> bool:
    stored = profile.get("password_hash") or ""
    if not stored or not password:
        return False
    return _verify_password(password, stored)


def touch_last_access(token: str) -> None:
    try:
        with get_db() as db:
            db.execute(
                "UPDATE driver_profiles SET last_access = ? WHERE token = ?",
                (_now_iso(), token),
            )
            db.commit()
    except Exception:
        pass  # non-critical


# ---------------------------------------------------------------------------
# Post-login access token (itsdangerous, NOT a Flask session)
# ---------------------------------------------------------------------------


def issue_access_token(token: str) -> str:
    """Sign the profile token so later data requests are authorized."""
    return _serializer().dumps({"t": token})


def verify_access_token(token: str, access_token: str) -> bool:
    """True iff ``access_token`` is a valid, unexpired signature for ``token``."""
    if not access_token:
        return False
    try:
        data = _serializer().loads(access_token, max_age=ACCESS_TOKEN_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    return isinstance(data, dict) and data.get("t") == token
