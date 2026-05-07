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
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

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


@bp.route("/api/compliance/months", methods=["GET"])
@login_required
def api_list_months():
    """List the YYYY-MM buckets the driver's DDD archive covers."""
    try:
        return _api_list_months_impl()
    except Exception as exc:
        _log.exception("compliance/months failed")
        return jsonify({
            "error": "compliance/months failed",
            "detail": str(exc),
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
    months: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in files:
        path = f.get("path") or f.get("path_lower") or ""
        name = f.get("name") or os.path.basename(path)
        m = _DDD_NAME_RE.search(name)
        if not m:
            continue
        date_str = m.group("date")
        ym = date_str[:7]  # YYYY-MM
        months[ym].append({
            "path": path,
            "name": name,
            "date": date_str,
            "size": f.get("size"),
        })

    out = [
        {"month": ym, "files": sorted(items, key=lambda x: x["date"])}
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
                ds = rec.get("activity_record_date", "")[:10]
                if not ds:
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
    vehicle = None
    if vehicles:
        sorted_vehicles = sorted(vehicles, key=lambda v: v.get("last_use", ""), reverse=True)
        vehicle = sorted_vehicles[0].get("plate") or None

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

    return jsonify(
        {
            "driver_card": driver_card,
            "driver_name": driver_name or di_for_card.get("driver_name", ""),
            "month": f"{year:04d}-{month:02d}",
            "vehicle": vehicle,
            "evaluation": evaluation,
            "report": report,
        },
    )
