"""Public route-share links.

A route share is a stable public URL (``/r/<token>``) that anyone can open to
follow ONE vehicle's route on a map, with history and reverse-geocoded
addresses — no login required. The dispatcher creates the link from the
"Śledzenie tras" page (vehicle + a live window of N hours, or a specific day),
optionally with an expiry, and can disable it at any time.

Mirrors ``driver_profile_service`` conventions:
    - ``token`` is random url-safe (~144 bits), the secret part of the URL.
    - The route data itself is fetched live from Samsara on each view, so
      there is nothing sensitive at rest beyond the share metadata.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any, Mapping

from database import get_db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_vehicles(vehicles) -> list[dict[str, str]]:
    """Normalize a list of {id, name, driver} dicts, dropping entries w/o id."""
    out = []
    for v in (vehicles or []):
        if not isinstance(v, dict):
            continue
        vid = str(v.get("id", "")).strip()
        if not vid:
            continue
        out.append({
            "id": vid,
            "name": (v.get("name") or "").strip(),
            "driver": (v.get("driver") or "").strip(),
        })
    return out


def _vehicles_from_row(row: Mapping[str, Any]) -> list[dict[str, str]]:
    raw = (row["vehicles_json"] if "vehicles_json" in row.keys() else "") or ""
    if raw:
        try:
            vs = _clean_vehicles(json.loads(raw))
            if vs:
                return vs
        except (ValueError, TypeError):
            pass
    # Fallback for legacy single-vehicle shares (pre vehicles_json column).
    return [{"id": row["vehicle_id"], "name": row["vehicle_name"] or "", "driver": row["driver_name"] or ""}]


def _row_to_dict(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "token": row["token"],
        "vehicle_id": row["vehicle_id"],
        "vehicle_name": row["vehicle_name"],
        "driver_name": row["driver_name"],
        "vehicles": _vehicles_from_row(row),
        "label": row["label"],
        "hours": row["hours"],
        "day": row["day"],
        "from_time": (row["from_time"] if "from_time" in row.keys() else "") or "",
        "to_time": (row["to_time"] if "to_time" in row.keys() else "") or "",
        "enabled": bool(row["enabled"]),
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
        "last_access": row["last_access"],
        "access_count": row["access_count"],
    }


def create_share(
    *,
    vehicles,
    label: str = "",
    hours: int = 24,
    day: str = "",
    from_time: str = "",
    to_time: str = "",
    expires_at: str = "",
    created_by: str = "admin",
) -> dict[str, Any]:
    vehicles = _clean_vehicles(vehicles)
    if not vehicles:
        raise ValueError("at least one vehicle is required")
    first = vehicles[0]
    try:
        hours = max(1, min(744, int(hours)))
    except (TypeError, ValueError):
        hours = 24
    token = secrets.token_urlsafe(18)
    now = _now_iso()
    with get_db() as db:
        db.execute(
            """
            INSERT INTO route_shares
            (token, vehicle_id, vehicle_name, driver_name, label, hours, day,
             from_time, to_time, vehicles_json, enabled, created_by, created_at,
             expires_at, last_access, access_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, '', 0)
            """,
            (token, first["id"], first["name"], first["driver"], label or "",
             hours, day or "", from_time or "", to_time or "",
             json.dumps(vehicles, ensure_ascii=False),
             created_by or "admin", now, expires_at or ""),
        )
        db.commit()
    return get_by_token(token)  # type: ignore[return-value]


def list_shares() -> list[dict[str, Any]]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM route_shares ORDER BY created_at DESC").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_by_token(token: str) -> dict[str, Any] | None:
    if not token or len(token) > 128:
        return None
    with get_db() as db:
        row = db.execute("SELECT * FROM route_shares WHERE token = ?", (token,)).fetchone()
    return _row_to_dict(row) if row else None


def get_by_id(share_id: int) -> dict[str, Any] | None:
    with get_db() as db:
        row = db.execute("SELECT * FROM route_shares WHERE id = ?", (share_id,)).fetchone()
    return _row_to_dict(row) if row else None


def set_enabled(share_id: int, enabled: bool) -> None:
    with get_db() as db:
        db.execute(
            "UPDATE route_shares SET enabled = ? WHERE id = ?",
            (1 if enabled else 0, share_id),
        )
        db.commit()


def delete_share(share_id: int) -> None:
    with get_db() as db:
        db.execute("DELETE FROM route_shares WHERE id = ?", (share_id,))
        db.commit()


def touch_access(token: str) -> None:
    try:
        with get_db() as db:
            db.execute(
                "UPDATE route_shares SET last_access = ?, access_count = access_count + 1 "
                "WHERE token = ?",
                (_now_iso(), token),
            )
            db.commit()
    except Exception:
        pass  # non-critical


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
