"""Driver signing tokens.

A signing token represents a one-time public URL that a driver opens to
review and sign a batch of compliance violations. The full violation
payload is frozen into the token at creation time so the document the
driver sees can never silently change between issuance and signature.

Flow:
    1. Dispatcher selects a driver + a set of violations in the admin UI.
    2. Backend calls `create_token(driver, payload)` → URL-safe token + URL.
    3. Driver opens https://<host>/sign/<token>, reviews, signs.
    4. `consume_token(token, signature_png, signer_name, remark, ip, ua)`
       marks the token used, generates the PDF, uploads to Dropbox.

Security:
    - Tokens are 32 random bytes, base64url-encoded (≈ 256 bits).
    - Single use enforced via `used_at IS NULL` AND `expires_at > now()`.
    - `payload_hash` (sha256) lets us detect tampering of the JSON snapshot
      between token creation and consumption.
    - We log IP + user-agent of the signer for audit.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from database import get_db


DEFAULT_TTL_DAYS = int(os.environ.get("SIGNING_TOKEN_TTL_DAYS", "14"))


class SigningError(RuntimeError):
    """Raised on any token-flow failure that should turn into a 4xx response."""

    def __init__(self, message: str, *, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class SigningToken:
    token: str
    driver_card: str
    driver_name: str
    payload: dict[str, Any]
    payload_hash: str
    locale: str
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None
    status: str
    signature_png: str | None
    signer_name: str | None
    driver_remark: str | None
    pdf_dropbox_path: str | None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row_to_token(row: Mapping[str, Any]) -> SigningToken:
    payload = json.loads(row["payload_json"])
    return SigningToken(
        token=row["token"],
        driver_card=row["driver_card"],
        driver_name=row["driver_name"],
        payload=payload,
        payload_hash=row["payload_hash"],
        locale=row["locale"],
        created_at=_parse_iso(row["created_at"]),
        expires_at=_parse_iso(row["expires_at"]),
        used_at=_parse_iso(row["used_at"]) if row["used_at"] else None,
        status=row["status"],
        signature_png=row["signature_png"],
        signer_name=row["signer_name"],
        driver_remark=row["driver_remark"],
        pdf_dropbox_path=row["pdf_dropbox_path"],
    )


def _parse_iso(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def create_token(
    *,
    driver_card: str,
    driver_name: str,
    payload: Mapping[str, Any],
    locale: str = "de",
    created_by: str = "admin",
    ttl_days: int = DEFAULT_TTL_DAYS,
) -> SigningToken:
    """Issue a fresh signing token for the given driver + payload."""
    if not driver_card:
        raise SigningError("driver_card is required")
    if not isinstance(payload, Mapping):
        raise SigningError("payload must be a JSON object")
    if locale not in ("de", "en", "pl"):
        raise SigningError(f"unsupported locale: {locale!r}")
    if ttl_days <= 0 or ttl_days > 90:
        raise SigningError("ttl_days must be 1..90")

    token = secrets.token_urlsafe(32)
    payload_str = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    payload_hash = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
    now = _now()
    expires = now + timedelta(days=ttl_days)

    with get_db() as db:
        db.execute(
            """
            INSERT INTO signing_tokens
            (token, driver_card, driver_name, payload_json, payload_hash, locale,
             created_by, created_at, expires_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                token,
                driver_card,
                driver_name or "",
                payload_str,
                payload_hash,
                locale,
                created_by,
                now.isoformat(),
                expires.isoformat(),
                "pending",
            ),
        )
        db.commit()

    return SigningToken(
        token=token,
        driver_card=driver_card,
        driver_name=driver_name or "",
        payload=dict(payload),
        payload_hash=payload_hash,
        locale=locale,
        created_at=now,
        expires_at=expires,
        used_at=None,
        status="pending",
        signature_png=None,
        signer_name=None,
        driver_remark=None,
        pdf_dropbox_path=None,
    )


def get_token(token: str) -> SigningToken:
    """Look up a token. Raises SigningError(404) if not found, (410) if expired/used."""
    if not token or len(token) > 128:
        raise SigningError("invalid token", status=404)
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM signing_tokens WHERE token = ?", (token,)
        ).fetchone()
    if not row:
        raise SigningError("not found", status=404)
    rec = _row_to_token(row)
    now = _now()
    if rec.used_at is not None:
        raise SigningError("already signed", status=410)
    if rec.expires_at <= now:
        # Mark expired so the admin UI sees the change.
        with get_db() as db:
            db.execute(
                "UPDATE signing_tokens SET status = 'expired' WHERE token = ? AND status = 'pending'",
                (token,),
            )
            db.commit()
        raise SigningError("link expired", status=410)
    return rec


def consume_token(
    token: str,
    *,
    signature_png_b64: str,
    signer_name: str,
    driver_remark: str | None,
    ip: str | None,
    user_agent: str | None,
    pdf_dropbox_path: str | None,
) -> SigningToken:
    """Mark a token as signed. Caller has already produced + uploaded the PDF."""
    rec = get_token(token)  # validates expiry / used
    if not signature_png_b64 or len(signature_png_b64) < 100:
        raise SigningError("signature_png_b64 missing or too short")
    if not signer_name or len(signer_name.strip()) < 2:
        raise SigningError("signer_name is required")

    now = _now()
    with get_db() as db:
        db.execute(
            """
            UPDATE signing_tokens
            SET used_at = ?, used_ip = ?, used_ua = ?,
                signature_png = ?, signer_name = ?, driver_remark = ?,
                pdf_dropbox_path = ?, status = 'signed'
            WHERE token = ? AND used_at IS NULL
            """,
            (
                now.isoformat(),
                (ip or "")[:64],
                (user_agent or "")[:256],
                signature_png_b64,
                signer_name.strip()[:128],
                (driver_remark or "").strip()[:1024] or None,
                pdf_dropbox_path,
                token,
            ),
        )
        db.commit()
    # Re-fetch (the get_token would now refuse because used_at is set, so
    # we do a raw read here):
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM signing_tokens WHERE token = ?", (token,)
        ).fetchone()
    return _row_to_token(row)


def list_tokens(*, driver_card: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
    """Admin listing. Returns JSON-friendly summaries (no payload, no signature)."""
    where: list[str] = []
    params: list[Any] = []
    if driver_card:
        where.append("driver_card = ?")
        params.append(driver_card)
    if status:
        where.append("status = ?")
        params.append(status)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    with get_db() as db:
        rows = db.execute(
            f"""
            SELECT token, driver_card, driver_name, locale, created_by,
                   created_at, expires_at, used_at, status, pdf_dropbox_path
            FROM signing_tokens
            {where_sql}
            ORDER BY created_at DESC
            LIMIT 500
            """,
            tuple(params),
        ).fetchall()
    return [dict(r) for r in rows]
