"""Password-protected links to the driver-card file archive (``/share/<token>``).

Meant for people outside the dispatch team, typically the accountant: an
admin creates a link with a password, sends both (separately) to the person,
and that person can browse the drivers' .ddd files and download them, one by
one or as a ZIP per driver and month. No FleetView account is involved; the
link can be disabled, given an expiry date, or have its password changed at
any time. Mirrors ``route_share_service`` conventions.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Mapping

import bcrypt

from database import get_db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(share: Mapping[str, Any], password: str) -> bool:
    try:
        return bcrypt.checkpw((password or "").encode("utf-8"), share["password_hash"].encode("ascii"))
    except (ValueError, KeyError, AttributeError):
        return False


def _row_to_dict(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "token": row["token"],
        "label": row["label"] or "",
        "password_hash": row["password_hash"],
        "enabled": bool(row["enabled"]),
        "created_by": row["created_by"] or "",
        "created_at": row["created_at"] or "",
        "expires_at": row["expires_at"] or "",
        "last_access": row["last_access"] or "",
        "access_count": int(row["access_count"] or 0),
        "download_count": int(row["download_count"] or 0),
    }


def create_share(*, label: str, password: str, expires_at: str = "", created_by: str = "admin") -> dict[str, Any]:
    if len(password or "") < 6:
        raise ValueError("password too short")
    token = secrets.token_urlsafe(18)
    with get_db() as db:
        db.execute(
            """
            INSERT INTO file_shares
            (token, label, password_hash, enabled, created_by, created_at, expires_at,
             last_access, access_count, download_count)
            VALUES (?, ?, ?, 1, ?, ?, ?, '', 0, 0)
            """,
            (token, (label or "").strip()[:120], _hash_password(password),
             created_by or "admin", _now_iso(), expires_at or ""),
        )
        db.commit()
    return get_by_token(token)  # type: ignore[return-value]


def list_shares() -> list[dict[str, Any]]:
    with get_db() as db:
        rows = db.query("SELECT * FROM file_shares ORDER BY created_at DESC")
    return [_row_to_dict(r) for r in rows]


def get_by_token(token: str) -> dict[str, Any] | None:
    if not token or len(token) > 128:
        return None
    with get_db() as db:
        row = db.query_one("SELECT * FROM file_shares WHERE token = ?", (token,))
    return _row_to_dict(row) if row else None


def get_by_id(share_id: int) -> dict[str, Any] | None:
    with get_db() as db:
        row = db.query_one("SELECT * FROM file_shares WHERE id = ?", (share_id,))
    return _row_to_dict(row) if row else None


def update_share(share_id: int, *, enabled: bool | None = None, password: str | None = None,
                 label: str | None = None, expires_at: str | None = None) -> None:
    sets, params = [], []
    if enabled is not None:
        sets.append("enabled = ?"); params.append(1 if enabled else 0)
    if password is not None:
        if len(password) < 6:
            raise ValueError("password too short")
        sets.append("password_hash = ?"); params.append(_hash_password(password))
    if label is not None:
        sets.append("label = ?"); params.append(label.strip()[:120])
    if expires_at is not None:
        sets.append("expires_at = ?"); params.append(expires_at)
    if not sets:
        return
    params.append(share_id)
    with get_db() as db:
        db.execute(f"UPDATE file_shares SET {', '.join(sets)} WHERE id = ?", tuple(params))
        db.commit()


def delete_share(share_id: int) -> None:
    with get_db() as db:
        db.execute("DELETE FROM file_shares WHERE id = ?", (share_id,))
        db.commit()


def touch_access(token: str) -> None:
    try:
        with get_db() as db:
            db.execute(
                "UPDATE file_shares SET last_access = ?, access_count = access_count + 1 WHERE token = ?",
                (_now_iso(), token),
            )
            db.commit()
    except Exception:
        pass  # non-critical


def bump_downloads(token: str, n: int = 1) -> None:
    try:
        with get_db() as db:
            db.execute(
                "UPDATE file_shares SET download_count = download_count + ? WHERE token = ?",
                (int(n), token),
            )
            db.commit()
    except Exception:
        pass


def is_expired(share: Mapping[str, Any]) -> bool:
    exp = (share.get("expires_at") or "").strip()
    if not exp:
        return False
    try:
        dt = datetime.fromisoformat(exp)
    except ValueError:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > dt


def is_live(share: Mapping[str, Any] | None) -> bool:
    return bool(share) and bool(share.get("enabled")) and not is_expired(share)
