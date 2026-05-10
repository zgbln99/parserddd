"""Monthly compliance Blueprint.

Endpoints:
    GET  /api/compliance/months?driver=<name>
        → list of YYYY-MM strings the driver has data for, with file paths.

    POST /api/compliance/monthly
        body: { driver_card, driver_name, year, month, locale, file_paths }
        → { evaluation, report }
        Loads the listed DDD files from Dropbox, parses, clips activities
        to the month (with padding for weekly rest math), feeds the
        compliance engine, and returns both the raw EvaluationResult and
        the locale-bound PdfReport.

The endpoint is admin-only — it triggers Dropbox downloads + Node subprocess.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import tempfile
import traceback
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

# Ensure the *parent* of ``backend/`` is on sys.path so that
# ``from backend.compliance.service import ...`` resolves regardless of
# whether gunicorn was started from the repo root or from inside
# ``backend/`` (production WorkingDirectory is the latter on some
# installs). Idempotent — added at most once per process.
_BACKEND_PARENT = str(Path(__file__).resolve().parent.parent.parent)
if _BACKEND_PARENT not in sys.path:
    sys.path.insert(0, _BACKEND_PARENT)

from flask import Blueprint, jsonify, request

from auth.decorators import login_required
from auth.helpers import _load_config
from core.parsers import parse_ddd_auto
from core.extractors import (
    get_card_events,
    get_card_places,
    get_driver_info,
    get_activity_records,
    get_vehicle_records,
)
from core.timeline import build_timeline
from services.compliance_adapter import (
    build_engine_payload,
    expand_padding,
    is_record_in_month,
    month_range_utc,
)
from services.compliance_engine import ComplianceEngine, ComplianceEngineError
from services.dropbox_service import build_drivers_data, get_server_dropbox_client


_log = logging.getLogger(__name__)


bp = Blueprint("compliance", __name__)


_DDD_NAME_RE = re.compile(r"(?P<date>\d{4}-\d{2}-\d{2})", re.ASCII)


# Categories of violations the dispatcher cares about by default. The driver
# only sees rule families that match here (plus anything explicitly added via
# the request's `categories` field). The set leaves OUT card-handling and
# manual-entry rules — operators report those are too noisy and the driver
# can't really do anything about them after the fact.
DEFAULT_CATEGORIES: tuple[str, ...] = (
    "DRIVING_TIME",
    "BREAKS",
    "REST",
    "WORKING_TIME",
    "NIGHT_WORK",
    "COUNTRY_ENTRY",
)


def _filter_report_by_categories(
    report: dict[str, Any],
    allowed: set[str],
) -> dict[str, Any]:
    """Trim a PdfReport to only the sections matching `allowed`.

    Recomputes the summary so totals line up with what the driver sees.
    Pure transform — caller is responsible for not mutating the original.
    """
    out_sections = []
    total = 0
    driver_total: float | None = 0.0
    company_total: float | None = 0.0
    by_category: dict[str, int] = {}

    for section in report.get("sections", []) or []:
        if section.get("category") not in allowed:
            continue
        rows = section.get("rows", []) or []
        if not rows:
            continue
        out_sections.append(section)
        total += len(rows)
        by_category[section["category"]] = len(rows)
        for r in rows:
            d = r.get("driver_fine_eur")
            c = r.get("company_fine_eur")
            if driver_total is not None:
                driver_total = None if d is None else driver_total + float(d)
            if company_total is not None:
                company_total = None if c is None else company_total + float(c)

    summary = dict(report.get("summary") or {})
    summary["total"] = total
    summary["driver_fine_total_eur"] = driver_total
    summary["company_fine_total_eur"] = company_total
    summary["by_category"] = by_category
    # not_evaluable_rule_ids stays as-is — the dispatcher should still see
    # which rules couldn't be evaluated, even if not in the driver-facing
    # categories.

    return {
        **report,
        "sections": out_sections,
        "summary": summary,
    }


@bp.route("/api/compliance/months", methods=["GET"])
@login_required
def api_list_months():
    """List the YYYY-MM buckets the driver's DDD archive covers."""
    try:
        return _api_list_months_impl()
    except Exception as exc:
        _log.exception("compliance/months failed")
        # Last frame of the traceback is the most useful for the operator —
        # it's where the exception was raised. We don't expose the full stack
        # trace (might leak filesystem layout or env hints) but the file +
        # line + exception class are enough to diagnose 90% of failures.
        tb = traceback.extract_tb(exc.__traceback__)
        last = tb[-1] if tb else None
        return jsonify({
            "error": "compliance/months failed",
            "exception_type": type(exc).__name__,
            "detail": str(exc),
            "where": (
                f"{os.path.basename(last.filename)}:{last.lineno} in {last.name}"
                if last else None
            ),
        }), 500


def _api_list_months_impl():
    driver_name = (request.args.get("driver") or "").strip()
    if not driver_name:
        return jsonify({"error": "driver is required"}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({"error": "Dropbox client not configured"}), 503

    cfg = _load_config()
    sync_folder = cfg.get("sync_folder") or os.environ.get("SYNC_DEST_FOLDER", "/Samsara-DDD")
    drivers = build_drivers_data(dbx, sync_folder)
    # Each entry has the shape produced by build_drivers_data: {name, path,
    # card_number, files, ...}. Match by name (preferred) or card_number.
    target = None
    needle = driver_name.lower()
    for d in drivers:
        if (d.get("name") or "").strip().lower() == needle:
            target = d
            break
    if target is None:
        for d in drivers:
            if (d.get("card_number") or "").strip() == driver_name.strip():
                target = d
                break
    if target is None:
        return jsonify({"error": f"driver not found: {driver_name}"}), 404

    files = target.get("files", []) or []
    months = defaultdict(list)
    for f in files:
        # build_drivers_data already extracts file_date — prefer it.
        date_str = (f.get("file_date") or "").strip()
        if not date_str:
            name = f.get("name") or ""
            m = _DDD_NAME_RE.search(name)
            if not m:
                continue
            date_str = m.group("date")
        if len(date_str) < 10:
            continue
        ym = date_str[:7]  # YYYY-MM
        size_val = f.get("size")
        try:
            size_val = int(size_val) if size_val is not None else None
        except (TypeError, ValueError):
            size_val = None
        months[ym].append({
            "path": f.get("path") or f.get("path_lower") or "",
            "name": f.get("name") or "",
            "date": date_str,
            "size": size_val,
        })

    out = [
        {
            "month": ym,
            "files": sorted(
                months[ym],
                key=lambda x: (x.get("date") or ""),
            ),
        }
        for ym in sorted(months.keys(), reverse=True)
    ]
    return jsonify(
        {
            "driver_name": target.get("name", ""),
            "card_number": target.get("card_number", ""),
            "months": out,
        },
    )


@bp.route("/api/compliance/monthly", methods=["POST"])
@login_required
def api_evaluate_monthly():
    """Evaluate compliance for a single driver-month."""
    try:
        return _api_evaluate_monthly_impl()
    except Exception as exc:
        _log.exception("compliance/monthly failed")
        return jsonify({
            "error": "compliance/monthly failed",
            "detail": str(exc),
        }), 500


def _api_evaluate_monthly_impl():
    data = request.get_json(silent=True) or {}
    driver_card = (data.get("driver_card") or "").strip()
    driver_name = (data.get("driver_name") or "").strip()
    locale = (data.get("locale") or "de").lower()
    file_paths = data.get("file_paths") or []
    # Optional whitelist of rule categories the driver should see. When not
    # provided we fall back to DEFAULT_CATEGORIES (working/driving time +
    # rests + breaks + night work + country entries). Pass an explicit list
    # to widen — e.g. ["CARD", "MANUAL_ENTRY"] to include those.
    categories_in = data.get("categories")
    if isinstance(categories_in, list) and categories_in:
        allowed_categories = {str(c).upper() for c in categories_in if c}
    else:
        allowed_categories = set(DEFAULT_CATEGORIES)
    try:
        year = int(data["year"])
        month = int(data["month"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "year and month (1..12) are required"}), 400

    if not driver_card:
        return jsonify({"error": "driver_card is required"}), 400
    if not isinstance(file_paths, list) or not file_paths:
        return jsonify({"error": "file_paths must be a non-empty list"}), 400
    if locale not in ("de", "en", "pl"):
        return jsonify({"error": f"unsupported locale: {locale}"}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({"error": "Dropbox client not configured"}), 503

    range_start, range_end = expand_padding(year, month, padding_days=14)
    strict_start, strict_end = month_range_utc(year, month)

    timeline_intervals: list[tuple[datetime, datetime, int, bool]] = []
    places: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    vehicles: list[dict[str, Any]] = []
    seen_record_dates: set[str] = set()
    di_for_card: dict[str, Any] = {}

    tmp_paths: list[str] = []
    try:
        for path in file_paths:
            try:
                _meta, response = dbx.files_download(path)
            except Exception as exc:  # pragma: no cover — Dropbox failures
                _log.warning("dropbox download failed for %s: %s", path, exc)
                continue
            with tempfile.NamedTemporaryFile(suffix=".ddd", delete=False) as tmp:
                tmp.write(response.content)
                tmp_paths.append(tmp.name)
            parsed = parse_ddd_auto(tmp.name)

            # Pick activity records that overlap the padded range.
            recs_in_range: list[dict[str, Any]] = []
            for rec in get_activity_records(parsed):
                # Defensive: `activity_record_date` may be missing OR present
                # with a None/empty value on corrupt DDD records. Coerce to
                # "" so the next slice + filter never crashes.
                ds_raw = rec.get("activity_record_date") or ""
                ds = str(ds_raw)[:10]
                if not ds or len(ds) != 10:
                    continue
                # Deduplicate across files by date (keep first encountered).
                if ds in seen_record_dates:
                    continue
                # Compare on UTC date — padded range is always UTC midnight.
                try:
                    rec_d = datetime.strptime(ds, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                except ValueError:
                    continue
                if range_start <= rec_d < range_end:
                    recs_in_range.append(rec)
                    seen_record_dates.add(ds)
                # Always remember at least the month-bucket records:
                if is_record_in_month(ds, year, month):
                    pass

            if recs_in_range:
                timeline_intervals.extend(build_timeline(recs_in_range))

            places.extend(get_card_places(parsed))
            events.extend(get_card_events(parsed))
            vehicles.extend(get_vehicle_records(parsed))

            di = get_driver_info(parsed)
            if not di_for_card and di.get("card_number"):
                di_for_card = di
    finally:
        for p in tmp_paths:
            try:
                os.unlink(p)
            except OSError:
                pass

    if not timeline_intervals:
        return jsonify(
            {
                "error": "no activity records in the requested month",
                "month": f"{year:04d}-{month:02d}",
                "driver_card": driver_card,
            },
        ), 404

    # Pick the most-recently-used vehicle plate as the canonical vehicle id.
    # Defensive sort: coerce missing/None timestamps to "" so sort never sees
    # mixed str/None and crashes with "'<' not supported between instances".
    vehicle = None
    if vehicles:
        sorted_vehicles = sorted(
            vehicles,
            key=lambda v: (v.get("last_use") or ""),
            reverse=True,
        )
        first = sorted_vehicles[0] if sorted_vehicles else {}
        vehicle = first.get("plate") or None

    rules_root = os.environ.get("COMPLIANCE_RULES_ROOT")
    if not rules_root:
        # Default to repo's rules/ folder (relative to this file).
        rules_root = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "rules"),
        )

    engine_payload = build_engine_payload(
        driver_card=driver_card,
        timeline=timeline_intervals,
        places=places,
        events=events,
        vehicle=vehicle,
        range_start=strict_start,
        range_end=strict_end,
        rules_root=rules_root,
        time_zone=request.args.get("tz") or "Europe/Berlin",
        locale=locale,
    )

    try:
        engine = ComplianceEngine()
        evaluation = engine.evaluate(engine_payload)
        report = engine.report(evaluation, locale=locale)
    except ComplianceEngineError as exc:
        return jsonify(
            {
                "error": "compliance engine failure",
                "detail": str(exc),
                "stderr": exc.stderr,
            },
        ), 500

    filtered_report = _filter_report_by_categories(report, allowed_categories)

    return jsonify(
        {
            "driver_card": driver_card,
            "driver_name": driver_name or di_for_card.get("driver_name", ""),
            "month": f"{year:04d}-{month:02d}",
            "vehicle": vehicle,
            # Engine output (full + filtered). The frontend uses `report`
            # for display + signing; `report_full` is kept for diagnostics.
            "evaluation": evaluation,
            "report": filtered_report,
            "report_full": report,
            "categories_applied": sorted(allowed_categories),
        },
    )


# ---------------------------------------------------------------------------
# Activity-based compliance — runs on top of the existing parser/analysis
# output. Lives in this blueprint so registration is unchanged, but the
# implementation delegates to ``backend.compliance.service`` (which does not
# touch the parser, the timeline, or any hour calculation).
# ---------------------------------------------------------------------------

@bp.route("/api/compliance/evaluate-parser-analysis", methods=["POST"])
@login_required
def api_evaluate_parser_analysis():
    """Run compliance on the output of the existing parser/analysis layer.

    Body: JSON containing either:
      * the dict returned by ``parse_ddd_auto`` (has ``card_driver_activity_1``),
      * or an already-built analysis result carrying ``timeline``,
        ``driver_info`` and ``vehicles`` (the shape ``analyze_card`` could
        be combined with).

    Returns: ``{ countryProfile, violations, events }``.

    This endpoint is purely additive — it does not re-parse files, does not
    recompute hours, does not modify the request payload, and never touches
    Samsara, downloads or fines.
    """
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"error": "JSON body is required"}), 400
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON body must be an object"}), 400

    country_profile = (payload.get("countryProfile") or "DE").upper()
    parser_analysis = payload.get("parserAnalysis")
    if parser_analysis is None:
        # Allow the body itself to be the analysis dict (more ergonomic).
        parser_analysis = {
            k: v for k, v in payload.items()
            if k not in ("countryProfile",)
        }
    if not isinstance(parser_analysis, dict) or not parser_analysis:
        return jsonify({"error": "parserAnalysis is required"}), 400

    # Imported lazily so the route module stays decoupled from the
    # compliance package's import chain at startup.
    from backend.compliance.service import (
        evaluate_parser_analysis_for_violations,
    )

    try:
        result = evaluate_parser_analysis_for_violations(
            parser_analysis,
            country_profile=country_profile,
            include_events=True,
        )
    except Exception as exc:
        _log.exception("compliance/evaluate-parser-analysis failed")
        return jsonify({
            "error": "compliance evaluation failed",
            "detail": str(exc),
        }), 500

    return jsonify(result)


# ---------------------------------------------------------------------------
# Range-based violations API — built on top of the activity-based engine.
# Uses the existing month-loading machinery (Dropbox + parse_ddd_auto +
# build_timeline) but filters the final violation list by an explicit
# date_from / date_to range and persists per-violation status.
# ---------------------------------------------------------------------------

from services import violations_service as _vs
from services.sign_service import SigningError as _SigningError
from services import sign_service as _sign_service


def _load_timeline_for_range(
    *,
    dbx,
    file_paths: list[str],
    range_start: datetime,
    range_end: datetime,
) -> tuple[
    list[tuple[datetime, datetime, int, bool]],
    dict[str, Any],
    list[dict[str, Any]],
    str | None,
]:
    """Download/parse listed DDD files and assemble timeline + metadata."""
    timeline_intervals: list[tuple[datetime, datetime, int, bool]] = []
    vehicles: list[dict[str, Any]] = []
    seen_record_dates: set[str] = set()
    di_for_card: dict[str, Any] = {}

    tmp_paths: list[str] = []
    try:
        for path in file_paths:
            try:
                _meta, response = dbx.files_download(path)
            except Exception as exc:  # pragma: no cover
                _log.warning("dropbox download failed for %s: %s", path, exc)
                continue
            with tempfile.NamedTemporaryFile(suffix=".ddd", delete=False) as tmp:
                tmp.write(response.content)
                tmp_paths.append(tmp.name)
            parsed = parse_ddd_auto(tmp.name)

            recs_in_range: list[dict[str, Any]] = []
            for rec in get_activity_records(parsed):
                ds_raw = rec.get("activity_record_date") or ""
                ds = str(ds_raw)[:10]
                if not ds or len(ds) != 10 or ds in seen_record_dates:
                    continue
                try:
                    rec_d = datetime.strptime(ds, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                except ValueError:
                    continue
                if range_start <= rec_d < range_end:
                    recs_in_range.append(rec)
                    seen_record_dates.add(ds)

            if recs_in_range:
                timeline_intervals.extend(build_timeline(recs_in_range))

            vehicles.extend(get_vehicle_records(parsed))
            di = get_driver_info(parsed)
            if not di_for_card and di.get("card_number"):
                di_for_card = di
    finally:
        for p in tmp_paths:
            try:
                os.unlink(p)
            except OSError:
                pass

    plate = None
    if vehicles:
        sorted_vehicles = sorted(
            vehicles, key=lambda v: (v.get("last_use") or ""), reverse=True,
        )
        plate = (sorted_vehicles[0] or {}).get("plate") or None

    return timeline_intervals, di_for_card, vehicles, plate


def _range_to_utc(date_from: str, date_to: str) -> tuple[datetime, datetime]:
    """Inclusive start, exclusive end of the requested range in UTC."""
    s = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    e = (
        datetime.strptime(date_to, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        + timedelta(days=1)
    )
    return s, e


@bp.route("/api/compliance/violations/evaluate", methods=["POST"])
@login_required
def api_violations_evaluate():
    """Evaluate the activity-based engine for a date range + driver."""
    try:
        return _api_violations_evaluate_impl()
    except Exception as exc:
        _log.exception("compliance/violations/evaluate failed")
        return jsonify({
            "error": "compliance evaluation failed",
            "detail": str(exc),
        }), 500


def _api_violations_evaluate_impl():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, Mapping):
        return jsonify({"error": "invalid body"}), 400

    driver_card = (data.get("driver_card") or "").strip()
    driver_name = (data.get("driver_name") or "").strip()
    date_from = (data.get("date_from") or "").strip()
    date_to = (data.get("date_to") or "").strip()
    file_paths = data.get("file_paths") or []
    locale = (data.get("locale") or "de").lower()
    country_profile = (data.get("country_profile") or "DE").upper()

    if not driver_card:
        return jsonify({"error": "driver_card is required"}), 400
    if not date_from or not date_to:
        return jsonify({"error": "date_from and date_to are required (YYYY-MM-DD)"}), 400
    if not isinstance(file_paths, list) or not file_paths:
        return jsonify({"error": "file_paths must be a non-empty list"}), 400

    try:
        range_start, range_end = _range_to_utc(date_from, date_to)
    except ValueError:
        return jsonify({"error": "invalid date format (use YYYY-MM-DD)"}), 400

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({"error": "Dropbox client not configured"}), 503

    timeline_intervals, _di, vehicles, plate = _load_timeline_for_range(
        dbx=dbx, file_paths=file_paths,
        range_start=range_start, range_end=range_end,
    )

    if not timeline_intervals:
        return jsonify({
            "driver_card": driver_card,
            "driver_name": driver_name,
            "vehicle": plate,
            "period": {"from": date_from, "to": date_to},
            "violations": [],
            "summary": {"count": 0},
        })

    # Build the analyze-card-like payload the new adapter accepts.
    parser_analysis = {
        "driver_info": {"card_number": driver_card, "driver_name": driver_name},
        "vehicles": [{"plate": plate}] if plate else [],
        "timeline": timeline_intervals,
    }

    from backend.compliance.service import (
        evaluate_parser_analysis_for_violations,
    )

    result = evaluate_parser_analysis_for_violations(
        parser_analysis,
        country_profile=country_profile,
        include_events=False,
    )
    violations = result.get("violations", [])
    violations = _vs.filter_by_range(
        violations, date_from=date_from, date_to=date_to,
    )
    violations = _vs.merge_statuses(violations)

    return jsonify({
        "driver_card": driver_card,
        "driver_name": driver_name,
        "vehicle": plate,
        "period": {"from": date_from, "to": date_to},
        "countryProfile": result.get("countryProfile", country_profile),
        "violations": violations,
        "summary": {
            "count": len(violations),
            "bySeverity": _count_by(violations, "severity"),
            "byRule": _count_by(violations, "ruleCode"),
        },
    })


def _count_by(items: list[dict[str, Any]], key: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for it in items:
        v = it.get(key) or ""
        out[v] = out.get(v, 0) + 1
    return out


@bp.route("/api/compliance/violations/status", methods=["POST"])
@login_required
def api_violation_status():
    """Persist a status change for one violation."""
    data = request.get_json(silent=True) or {}
    if not isinstance(data, Mapping):
        return jsonify({"error": "invalid body"}), 400

    violation_id = (data.get("violation_id") or "").strip()
    status = (data.get("status") or "").strip().upper()
    note = (data.get("note") or "").strip()
    rule_code = (data.get("rule_code") or "").strip()
    driver_card = (data.get("driver_card") or "").strip()

    if not violation_id:
        return jsonify({"error": "violation_id is required"}), 400
    if status not in _vs.ALLOWED_STATUSES:
        return jsonify({"error": f"invalid status: {status}"}), 400

    try:
        _vs.set_status(
            violation_id,
            status=status, note=note,
            rule_code=rule_code, driver_card=driver_card,
            updated_by=str(getattr(request, "remote_addr", "") or ""),
        )
    except Exception as exc:
        _log.exception("violation/status failed")
        return jsonify({"error": "status update failed", "detail": str(exc)}), 500

    return jsonify({"ok": True, "violation_id": violation_id, "status": status})


@bp.route("/api/compliance/violations/sign-link", methods=["POST"])
@login_required
def api_violations_sign_link():
    """Create a public sign URL for a bundle of activity-based violations."""
    data = request.get_json(silent=True) or {}
    if not isinstance(data, Mapping):
        return jsonify({"error": "invalid body"}), 400

    driver_card = (data.get("driver_card") or "").strip()
    driver_name = (data.get("driver_name") or "").strip()
    locale = (data.get("locale") or "de").lower()
    period_label = (data.get("period_label") or "").strip()
    violations = data.get("violations") or []

    if not driver_card:
        return jsonify({"error": "driver_card is required"}), 400
    if not isinstance(violations, list) or not violations:
        return jsonify({"error": "violations must be a non-empty list"}), 400

    payload = _vs.violations_to_pdf_payload(
        violations,
        driver_card=driver_card, driver_name=driver_name,
        locale=locale, period_label=period_label,
    )

    try:
        rec = _sign_service.create_token(
            driver_card=driver_card,
            driver_name=driver_name,
            payload=payload,
            locale=locale,
        )
    except _SigningError as exc:
        return jsonify({"error": str(exc)}), exc.status

    # Record the token on every violation so the public sign callback can
    # flip them all to SIGNED in one go.
    for v in violations:
        vid = v.get("id") or ""
        if not vid:
            continue
        try:
            _vs.set_status(
                vid,
                status=v.get("status") or "DRIVER_NOTIFIED",
                rule_code=v.get("ruleCode") or "",
                driver_card=driver_card,
                signed_token=rec.token,
                updated_by="sign-link",
            )
        except Exception:
            _log.warning("could not persist signed_token for %s", vid)

    base_url = request.host_url.rstrip("/")
    return jsonify({
        "token": rec.token,
        "url": f"{base_url}/sign/{rec.token}",
        "expires_at": rec.expires_at.isoformat(),
        "payload_hash": rec.payload_hash,
    })
