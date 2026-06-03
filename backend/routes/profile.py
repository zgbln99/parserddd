"""Driver profile endpoints — public (password-gated) + admin.

Public (no Flask login, link is the bearer):
    GET  /api/profile/<token>            → minimal metadata (driver name)
    POST /api/profile/<token>/login      → verify password, hand out access token + months
    POST /api/profile/<token>/data       → shifts + diets for one month (access token required)

Admin (Flask login):
    GET    /api/admin/driver-profiles                 → list
    POST   /api/admin/driver-profiles                 → create / update (name, password)
    POST   /api/admin/driver-profiles/<card>/password → reset password
    POST   /api/admin/driver-profiles/<card>/toggle   → enable / disable
    DELETE /api/admin/driver-profiles/<card>          → delete

The driver only ever sees the shift table + diet summary for the chosen
month. No compliance, no fines, no admin data — "nic więcej".
"""

from __future__ import annotations

import os
import tempfile
from datetime import date, datetime, timedelta

from flask import Blueprint, jsonify, request

from auth.decorators import login_required
from auth.helpers import (
    _check_rate_limit,
    _clear_rate_limit,
    _load_config,
    _log_activity,
    _record_failed_login,
)
from core.analysis import analyze_card
from core.parsers import parse_ddd_auto
from routes.analysis import _build_merged_ddd, _get_driver_analysis_flags
from services import driver_profile_service as svc
from services.driver_profile_service import ProfileError
from services.dropbox_service import (
    build_drivers_data,
    get_server_dropbox_client,
    load_portal_cache,
)

bp = Blueprint("profile", __name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _find_driver_files(card_number: str) -> tuple[str, list[dict]]:
    """Return ``(driver_name, files)`` for a card from the storage listing.

    Uses the cached portal listing when available; falls back to a fresh
    build. ``files`` carries ``path`` + ``file_date`` per the storage layout.
    """
    drivers = load_portal_cache()
    if not drivers:
        dbx = get_server_dropbox_client()
        if not dbx:
            raise ProfileError("storage not configured", status=503)
        sync_folder = os.environ.get("SYNC_DEST_FOLDER", "/Samsara-DDD")
        drivers = build_drivers_data(dbx, sync_folder)
    for d in drivers or []:
        if d.get("card_number") == card_number:
            return d.get("name", ""), d.get("files", []) or []
    return "", []


def _available_months(files: list[dict]) -> list[str]:
    """YYYY-MM list spanning the driver's data, newest first.

    A card download dated D holds activity for roughly the preceding 28
    days, so we include the month before the earliest file too.
    """
    dates = sorted(f.get("file_date", "") for f in files if f.get("file_date"))
    if not dates:
        return []
    try:
        first = datetime.strptime(dates[0], "%Y-%m-%d").date().replace(day=1)
        last = datetime.strptime(dates[-1], "%Y-%m-%d").date().replace(day=1)
    except ValueError:
        return []
    # one month of lookback for the earliest download
    first = (first - timedelta(days=1)).replace(day=1)
    months: list[str] = []
    cur = first
    while cur <= last:
        months.append(cur.strftime("%Y-%m"))
        cur = (cur + timedelta(days=32)).replace(day=1)
    return list(reversed(months))


def _files_for_month(files: list[dict], ym: str) -> list[dict]:
    """Pick the files whose ~28-day window overlaps the requested month.

    We keep files dated from the month start up to ~5 weeks after the month
    end, plus the most recent file just before the month start (it covers
    the early days). Capped to the 4 most relevant downloads.
    """
    try:
        start = datetime.strptime(ym + "-01", "%Y-%m-%d").date()
    except ValueError:
        return []
    end = (start + timedelta(days=32)).replace(day=1)  # first of next month
    window_end = end + timedelta(days=35)

    def fdate(f: dict) -> date | None:
        try:
            return datetime.strptime(f.get("file_date", ""), "%Y-%m-%d").date()
        except ValueError:
            return None

    in_window = [f for f in files if (d := fdate(f)) and start <= d < window_end]
    # the latest download strictly before the month — covers its first days
    before = [f for f in files if (d := fdate(f)) and d < start]
    before.sort(key=lambda f: f.get("file_date", ""))
    if before:
        in_window.append(before[-1])

    # de-dup by path, newest first, cap to 4
    seen: set[str] = set()
    picked: list[dict] = []
    for f in sorted(in_window, key=lambda f: f.get("file_date", ""), reverse=True):
        p = f.get("path", "")
        if p and p not in seen:
            seen.add(p)
            picked.append(f)
    return picked[:4]


def _analyze_month(card_number: str, files: list[dict], ym: str) -> dict:
    """Download + merge + analyze the month's files, filtered to ``ym``."""
    month_files = _files_for_month(files, ym)
    if not month_files:
        raise ProfileError("no data for this month", status=404)

    dbx = get_server_dropbox_client()
    if not dbx:
        raise ProfileError("storage not configured", status=503)

    tmp_paths: list[str] = []
    try:
        parsed = []
        for f in month_files:
            _meta, response = dbx.files_download(f["path"])
            with tempfile.NamedTemporaryFile(suffix=".ddd", delete=False) as tmp:
                tmp.write(response.content)
                tmp_paths.append(tmp.name)
            parsed.append(parse_ddd_auto(tmp.name))

        if len(parsed) == 1:
            data = parsed[0]
        else:
            data, _days = _build_merged_ddd(parsed)

        flags = _get_driver_analysis_flags(data)
        result = analyze_card(
            data,
            config_loader=_load_config,
            night_40_check_midnight=flags["night_40_check_midnight"],
            pause_cap_enabled=flags["pause_cap_enabled"],
            weekend_diet=flags["weekend_diet"],
            night_includes_breaks=flags["night_includes_breaks"],
        )
    finally:
        for p in tmp_paths:
            try:
                os.unlink(p)
            except OSError:
                pass

    # Keep only shifts inside the requested month — and only the shift/diet
    # facing fields. Nothing compliance-related leaves the building.
    shifts = [
        s
        for s in result.get("shift_details", [])
        if (s.get("shift_date") or s.get("grid_date") or "").startswith(ym)
    ]

    diet_count = sum(1 for s in shifts if s.get("has_diet"))
    cfg = _driver_diet_config(card_number)
    per_diet = cfg["diet_rate"] * (2 if cfg["double_diet"] else 1)

    return {
        "month": ym,
        "shifts": shifts,
        "summary": {"diet_count": diet_count, "total_shifts": len(shifts)},
        "diet_rate": cfg["diet_rate"],
        "double_diet": cfg["double_diet"],
        "diet_total_eur": round(diet_count * per_diet, 2),
    }


def _driver_diet_config(card_number: str) -> dict:
    """Diet rate + double flag from driver_config (defaults if unset)."""
    out = {"diet_rate": 14.0, "double_diet": False}
    try:
        from auth.helpers import _get_db

        conn = _get_db()
        row = conn.execute(
            "SELECT diet_rate, double_diet FROM driver_config WHERE card_number = ?",
            (card_number,),
        ).fetchone()
        conn.close()
        if row:
            out["diet_rate"] = float(row["diet_rate"] or 14.0)
            out["double_diet"] = bool(row["double_diet"])
    except Exception:
        pass
    return out


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------


@bp.route("/api/profile/<token>", methods=["GET"])
def api_profile_meta(token: str):
    profile = svc.get_by_token(token)
    if not profile or not profile["enabled"]:
        return jsonify({"error": "not found", "status": "invalid"}), 404
    cfg = _load_config()
    return jsonify(
        {
            "driver_name": profile["driver_name"],
            "company_name": cfg.get("company_name", "LTS Logistik GmbH"),
            "needs_password": True,
        }
    )


@bp.route("/api/profile/<token>/login", methods=["POST"])
def api_profile_login(token: str):
    ip = request.remote_addr or "0.0.0.0"
    if _check_rate_limit(ip):
        return jsonify({"error": "Too many attempts. Try again later."}), 429

    profile = svc.get_by_token(token)
    if not profile or not profile["enabled"]:
        return jsonify({"error": "not found", "status": "invalid"}), 404

    data = request.get_json(silent=True) or {}
    password = (data.get("password") or "").strip()
    if not svc.verify_password(profile, password):
        _record_failed_login(ip)
        return jsonify({"error": "wrong password"}), 401

    _clear_rate_limit(ip)
    svc.touch_last_access(token)

    driver_name, files = _find_driver_files(profile["card_number"])
    months = _available_months(files)
    return jsonify(
        {
            "access_token": svc.issue_access_token(token),
            "driver_name": profile["driver_name"] or driver_name,
            "months": months,
            "default_month": months[0] if months else "",
        }
    )


@bp.route("/api/profile/<token>/data", methods=["POST"])
def api_profile_data(token: str):
    profile = svc.get_by_token(token)
    if not profile or not profile["enabled"]:
        return jsonify({"error": "not found", "status": "invalid"}), 404

    data = request.get_json(silent=True) or {}
    access_token = (data.get("access_token") or "").strip()
    if not svc.verify_access_token(token, access_token):
        return jsonify({"error": "session expired", "status": "expired"}), 401

    month = (data.get("month") or "").strip()
    if not month or len(month) != 7:
        return jsonify({"error": "month (YYYY-MM) required"}), 400

    _driver_name, files = _find_driver_files(profile["card_number"])
    try:
        result = _analyze_month(profile["card_number"], files, month)
    except ProfileError as exc:
        return jsonify({"error": str(exc)}), exc.status
    except Exception as exc:  # pragma: no cover — surface parse/storage errors
        return jsonify({"error": str(exc)}), 500

    result["driver_name"] = profile["driver_name"] or _driver_name
    return jsonify(result)


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------


def _with_url(profile: dict) -> dict:
    base = request.host_url.rstrip("/")
    profile = dict(profile)
    profile["url"] = f"{base}/profil/{profile['token']}"
    return profile


@bp.route("/api/admin/driver-profiles", methods=["GET"])
@login_required
def api_admin_list_profiles():
    items = [_with_url(p) for p in svc.list_profiles()]
    return jsonify({"items": items})


@bp.route("/api/admin/driver-profiles", methods=["POST"])
@login_required
def api_admin_create_profile():
    data = request.get_json(silent=True) or {}
    card_number = (data.get("card_number") or "").strip()
    driver_name = (data.get("driver_name") or "").strip()
    password = (data.get("password") or "").strip()
    if not card_number:
        return jsonify({"error": "card_number is required"}), 400
    if password and len(password) < 4:
        return jsonify({"error": "password too short (min 4)"}), 400
    try:
        profile = svc.create_or_update_profile(
            card_number=card_number, driver_name=driver_name, password=password or None
        )
    except ProfileError as exc:
        return jsonify({"error": str(exc)}), exc.status
    _log_activity("driver_profile_create", f"{driver_name} ({card_number})")
    item = {
        "card_number": profile["card_number"],
        "driver_name": profile["driver_name"],
        "token": profile["token"],
        "enabled": profile["enabled"],
        "has_password": bool(profile["password_hash"]),
        "created_at": profile["created_at"],
        "updated_at": profile["updated_at"],
        "last_access": profile["last_access"],
    }
    return jsonify(_with_url(item))


@bp.route("/api/admin/driver-profiles/<card_number>/password", methods=["POST"])
@login_required
def api_admin_set_password(card_number: str):
    data = request.get_json(silent=True) or {}
    password = (data.get("password") or "").strip()
    if len(password) < 4:
        return jsonify({"error": "password too short (min 4)"}), 400
    try:
        svc.set_password(card_number, password)
    except ProfileError as exc:
        return jsonify({"error": str(exc)}), exc.status
    _log_activity("driver_profile_password", card_number)
    return jsonify({"ok": True})


@bp.route("/api/admin/driver-profiles/<card_number>/toggle", methods=["POST"])
@login_required
def api_admin_toggle_profile(card_number: str):
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get("enabled", True))
    try:
        svc.set_enabled(card_number, enabled)
    except ProfileError as exc:
        return jsonify({"error": str(exc)}), exc.status
    _log_activity("driver_profile_toggle", f"{card_number} -> {enabled}")
    return jsonify({"ok": True})


@bp.route("/api/admin/driver-profiles/<card_number>", methods=["DELETE"])
@login_required
def api_admin_delete_profile(card_number: str):
    svc.delete_profile(card_number)
    _log_activity("driver_profile_delete", card_number)
    return jsonify({"ok": True})
