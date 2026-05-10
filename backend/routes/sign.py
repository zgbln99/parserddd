"""Driver signing endpoints — public + admin.

Public (no authentication, token-bearer):
    GET  /api/sign/<token>          → metadata + violation rows the driver should see
    POST /api/sign/<token>          → submit signature, render PDF, upload to Dropbox

Admin (requires login):
    POST /api/admin/sign-links      → create a new token for a driver + violations
    GET  /api/admin/sign-links      → list tokens (status, expiry, dropbox path)

The public routes are deliberately NOT under the admin blueprint and do not
require login — they identify the driver via the token only. Tokens are
single-use and TTL-bound (default 14 days).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

from flask import Blueprint, jsonify, request

from auth.decorators import login_required
from services import sign_service
from services.sign_service import SigningError
from services.sign_pdf import (
    HAS_REPORTLAB,
    render_signed_pdf,
    upload_signed_pdf_to_dropbox,
)


bp = Blueprint("sign", __name__)


# ---------- public -----------------------------------------------------------


@bp.route("/api/sign/<token>", methods=["GET"])
def api_sign_get(token: str):
    try:
        rec = sign_service.get_token(token)
    except SigningError as exc:
        return jsonify({"error": str(exc), "status": "invalid"}), exc.status

    # Strip server-only fields before returning to the public.
    return jsonify(
        {
            "token": rec.token,
            "driver_card": rec.driver_card,
            "driver_name": rec.driver_name,
            "locale": rec.locale,
            "expires_at": rec.expires_at.isoformat(),
            "payload": rec.payload,
            "payload_hash": rec.payload_hash,
        },
    )


@bp.route("/api/sign/<token>", methods=["POST"])
def api_sign_post(token: str):
    data = request.get_json(silent=True) or {}
    if not isinstance(data, Mapping):
        return jsonify({"error": "invalid body"}), 400

    signature_png_b64 = (data.get("signature_png_b64") or "").strip()
    signer_name = (data.get("signer_name") or "").strip()
    driver_remark = (data.get("driver_remark") or "").strip() or None

    if not signature_png_b64 or len(signature_png_b64) < 100:
        return jsonify({"error": "signature_png_b64 missing"}), 400
    if not signer_name or len(signer_name) < 2:
        return jsonify({"error": "signer_name is required"}), 400

    try:
        rec = sign_service.get_token(token)
    except SigningError as exc:
        return jsonify({"error": str(exc), "status": "invalid"}), exc.status

    if not HAS_REPORTLAB:
        return (
            jsonify(
                {
                    "error": "PDF rendering not available on the server (reportlab missing)",
                },
            ),
            503,
        )

    signed_at = datetime.now(timezone.utc)
    pdf_bytes = render_signed_pdf(
        payload=rec.payload,
        driver_card=rec.driver_card,
        driver_name=rec.driver_name,
        locale=rec.locale,
        signer_name=signer_name,
        signature_png_b64=signature_png_b64,
        driver_remark=driver_remark,
        payload_hash=rec.payload_hash,
        signed_at=signed_at,
    )

    dropbox_path: str | None = None
    try:
        dropbox_path = upload_signed_pdf_to_dropbox(
            pdf_bytes=pdf_bytes,
            driver_card=rec.driver_card,
            driver_name=rec.driver_name,
            signed_at=signed_at,
            token=rec.token,
        )
    except Exception as exc:  # pragma: no cover — Dropbox can fail; surface it
        # We still record the signature locally so the driver doesn't have to
        # repeat the flow when Dropbox recovers — admin UI shows the missing
        # path and a re-upload action.
        dropbox_path = None
        upload_error = str(exc)
    else:
        upload_error = None

    try:
        sign_service.consume_token(
            token,
            signature_png_b64=signature_png_b64,
            signer_name=signer_name,
            driver_remark=driver_remark,
            ip=request.headers.get("X-Forwarded-For", request.remote_addr),
            user_agent=request.headers.get("User-Agent", ""),
            pdf_dropbox_path=dropbox_path,
        )
    except SigningError as exc:
        return jsonify({"error": str(exc), "status": "invalid"}), exc.status

    # If this token bundles activity-based compliance violations, flip
    # their status to SIGNED. No-op for sign-tokens created outside the
    # compliance flow.
    try:
        from services import violations_service as _vs
        _vs.mark_token_signed(token)
    except Exception:  # pragma: no cover - log-only
        pass

    return jsonify(
        {
            "ok": True,
            "dropbox_path": dropbox_path,
            "upload_error": upload_error,
            "signed_at": signed_at.isoformat(),
        },
    )


# ---------- admin ------------------------------------------------------------


@bp.route("/api/admin/sign-links", methods=["POST"])
@login_required
def api_admin_create_link():
    data: dict[str, Any] = request.get_json(silent=True) or {}
    driver_card = (data.get("driver_card") or "").strip()
    driver_name = (data.get("driver_name") or "").strip()
    locale = (data.get("locale") or "de").lower()
    payload = data.get("payload")

    if not driver_card:
        return jsonify({"error": "driver_card is required"}), 400
    if not isinstance(payload, dict):
        return jsonify({"error": "payload must be an object (engine PdfReport)"}), 400

    try:
        rec = sign_service.create_token(
            driver_card=driver_card,
            driver_name=driver_name,
            payload=payload,
            locale=locale,
        )
    except SigningError as exc:
        return jsonify({"error": str(exc)}), exc.status

    base_url = request.host_url.rstrip("/")
    return jsonify(
        {
            "token": rec.token,
            "url": f"{base_url}/sign/{rec.token}",
            "expires_at": rec.expires_at.isoformat(),
            "payload_hash": rec.payload_hash,
        },
    )


@bp.route("/api/admin/sign-links", methods=["GET"])
@login_required
def api_admin_list_links():
    driver_card = request.args.get("driver_card") or None
    status = request.args.get("status") or None
    return jsonify({"items": sign_service.list_tokens(driver_card=driver_card, status=status)})


# ----- TEST endpoint --------------------------------------------------------
#
# Lets a dispatcher generate a fully-functional signing link backed by
# fabricated violations. No Dropbox, no DDD parsing, no compliance engine
# subprocess — just a fixed payload that exercises the full
# /sign/<token> page + signature canvas + PDF rendering + Dropbox upload.
#
# Useful for:
#   - Smoke-testing after deploys ("does the page actually render?")
#   - Reviewing PDF design without burning real driver data
#   - Showing the flow to non-technical stakeholders


@bp.route("/api/admin/sign-links/test", methods=["POST"])
@login_required
def api_admin_create_test_link():
    data = request.get_json(silent=True) or {}
    driver_card = (data.get("driver_card") or "TEST-CARD-001").strip()
    driver_name = (data.get("driver_name") or "Hans Mustermann").strip()
    locale = (data.get("locale") or "de").lower()
    if locale not in ("de", "en", "pl"):
        locale = "de"

    payload = _build_synthetic_payload(locale=locale, driver_card=driver_card)

    try:
        rec = sign_service.create_token(
            driver_card=driver_card,
            driver_name=driver_name,
            payload=payload,
            locale=locale,
            created_by="test",
        )
    except SigningError as exc:
        return jsonify({"error": str(exc)}), exc.status

    base_url = request.host_url.rstrip("/")
    return jsonify({
        "token": rec.token,
        "url": f"{base_url}/sign/{rec.token}",
        "expires_at": rec.expires_at.isoformat(),
        "payload_hash": rec.payload_hash,
        "test": True,
    })


def _build_synthetic_payload(*, locale: str, driver_card: str) -> dict:
    """Hand-crafted PdfReport mirroring the engine's output shape.

    Six violations across the driver-facing categories so reviewers can
    see how the layout copes with mixed kinds. Times are anchored on the
    last weekday so dates look plausible without being suspicious.
    """
    from datetime import datetime, timedelta, timezone
    base = datetime.now(timezone.utc).replace(hour=6, minute=0, second=0, microsecond=0) - timedelta(days=7)

    def t(offset_h: float) -> str:
        return (base + timedelta(hours=offset_h)).isoformat().replace("+00:00", "Z")

    headings = {
        "de": {
            "DRIVING_TIME": "Lenkzeit",
            "BREAKS": "Lenkpausen",
            "REST": "Ruhezeiten",
            "WORKING_TIME": "Arbeitszeit",
            "COUNTRY_ENTRY": "Ländereingaben",
        },
        "en": {
            "DRIVING_TIME": "Driving time",
            "BREAKS": "Breaks",
            "REST": "Rest periods",
            "WORKING_TIME": "Working time",
            "COUNTRY_ENTRY": "Country entries",
        },
        "pl": {
            "DRIVING_TIME": "Czas jazdy",
            "BREAKS": "Przerwy",
            "REST": "Odpoczynki",
            "WORKING_TIME": "Czas pracy",
            "COUNTRY_ENTRY": "Wpisy państw",
        },
    }[locale]

    titles = {
        "de": {
            "daily": "Tägliche Lenkzeit überschritten",
            "break": "Fehlende Pause nach 4,5 Stunden",
            "daily_rest": "Tägliche Ruhezeit verkürzt",
            "weekly_work": "Wöchentliche Arbeitszeit überschritten",
            "country_start": "Fehlendes Anfangsland",
            "country_end": "Fehlendes Endland",
        },
        "en": {
            "daily": "Daily driving time exceeded",
            "break": "Missing break after 4.5 hours",
            "daily_rest": "Daily rest reduced",
            "weekly_work": "Weekly working time exceeded",
            "country_start": "Missing start country",
            "country_end": "Missing end country",
        },
        "pl": {
            "daily": "Przekroczony dzienny czas jazdy",
            "break": "Brak przerwy po 4,5 godziny jazdy",
            "daily_rest": "Skrócony odpoczynek dzienny",
            "weekly_work": "Przekroczony tygodniowy czas pracy",
            "country_start": "Brak kraju rozpoczęcia",
            "country_end": "Brak kraju zakończenia",
        },
    }[locale]

    explanations = {
        "de": {
            "daily": "Tägliche Lenkzeit überschreitet 9 Stunden — keine Verlängerung verfügbar.",
            "break": "5 Stunden Lenken am Stück ohne 45-Min-Pause oder zulässigen 15+30-Split.",
            "daily_rest": "Innerhalb 24 Stunden nach Schichtbeginn weniger als 9 Stunden Ruhe.",
            "weekly_work": "Arbeitszeit (Lenken + Arbeiten) in der Woche über 60 Stunden.",
            "country_start": "Bei Schichtbeginn wurde kein Land in den Tachograph eingegeben.",
            "country_end": "Bei Schichtende wurde kein Land in den Tachograph eingegeben.",
        },
        "en": {
            "daily": "Daily driving exceeds the 9h limit, no extension available.",
            "break": "5h continuous driving without a 45-min break or legal 15+30 split.",
            "daily_rest": "Less than 9h rest within 24h of shift start.",
            "weekly_work": "Work + driving sum over 60h for the week.",
            "country_start": "No country entered at shift start.",
            "country_end": "No country entered at shift end.",
        },
        "pl": {
            "daily": "Dzienny czas jazdy przekracza 9h, brak dostępnego wydłużenia.",
            "break": "5h ciągłej jazdy bez 45-min przerwy lub legalnego podziału 15+30.",
            "daily_rest": "Poniżej 9h odpoczynku w ciągu 24h od początku zmiany.",
            "weekly_work": "Suma pracy + jazdy w tygodniu powyżej 60h.",
            "country_start": "Brak wpisu kraju przy rozpoczęciu zmiany.",
            "country_end": "Brak wpisu kraju przy zakończeniu zmiany.",
        },
    }[locale]

    sections = [
        {
            "category": "DRIVING_TIME",
            "heading": headings["DRIVING_TIME"],
            "rows": [
                {
                    "rule_id": "EU_561_ART6_DAILY_DRIVING",
                    "category": "DRIVING_TIME",
                    "title": titles["daily"],
                    "legal_basis": "Art. 6(1) Regulation (EC) 561/2006",
                    "explanation": explanations["daily"],
                    "start_time": t(0),
                    "end_time": t(10.5),
                    "measured_value": 630,
                    "allowed_value": 540,
                    "excess_value": 90,
                    "unit": "minutes",
                    "driver_fine_eur": None,
                    "company_fine_eur": None,
                    "status": "pending",
                    "severity": "SERIOUS",
                },
            ],
            "subtotal_driver_eur": None,
            "subtotal_company_eur": None,
        },
        {
            "category": "BREAKS",
            "heading": headings["BREAKS"],
            "rows": [
                {
                    "rule_id": "EU_561_ART7_BREAK_AFTER_4H30",
                    "category": "BREAKS",
                    "title": titles["break"],
                    "legal_basis": "Art. 7 Regulation (EC) 561/2006",
                    "explanation": explanations["break"],
                    "start_time": t(0),
                    "end_time": t(5),
                    "measured_value": 300,
                    "allowed_value": 270,
                    "excess_value": 30,
                    "unit": "minutes",
                    "driver_fine_eur": None,
                    "company_fine_eur": None,
                    "status": "pending",
                    "severity": "MINOR",
                },
            ],
            "subtotal_driver_eur": None,
            "subtotal_company_eur": None,
        },
        {
            "category": "REST",
            "heading": headings["REST"],
            "rows": [
                {
                    "rule_id": "EU_561_ART8_DAILY_REST",
                    "category": "REST",
                    "title": titles["daily_rest"],
                    "legal_basis": "Art. 8 Regulation (EC) 561/2006",
                    "explanation": explanations["daily_rest"],
                    "start_time": t(15),
                    "end_time": t(22),
                    "measured_value": 420,
                    "allowed_value": 540,
                    "excess_value": 120,
                    "unit": "minutes",
                    "driver_fine_eur": None,
                    "company_fine_eur": None,
                    "status": "pending",
                    "severity": "SERIOUS",
                },
            ],
            "subtotal_driver_eur": None,
            "subtotal_company_eur": None,
        },
        {
            "category": "WORKING_TIME",
            "heading": headings["WORKING_TIME"],
            "rows": [
                {
                    "rule_id": "DE_KRFARBZG_WEEKLY_WORKING_TIME",
                    "category": "WORKING_TIME",
                    "title": titles["weekly_work"],
                    "legal_basis": "§ 3 KrFArbZG",
                    "explanation": explanations["weekly_work"],
                    "start_time": t(-24 * 6),
                    "end_time": t(0),
                    "measured_value": 3780,
                    "allowed_value": 3600,
                    "excess_value": 180,
                    "unit": "minutes",
                    "driver_fine_eur": None,
                    "company_fine_eur": None,
                    "status": "pending",
                    "severity": "MINOR",
                },
            ],
            "subtotal_driver_eur": None,
            "subtotal_company_eur": None,
        },
        {
            "category": "COUNTRY_ENTRY",
            "heading": headings["COUNTRY_ENTRY"],
            "rows": [
                {
                    "rule_id": "EU_165_MISSING_START_COUNTRY",
                    "category": "COUNTRY_ENTRY",
                    "title": titles["country_start"],
                    "legal_basis": "Art. 34(7) Regulation (EU) 165/2014",
                    "explanation": explanations["country_start"],
                    "start_time": t(-24),
                    "end_time": t(-24),
                    "measured_value": 0,
                    "allowed_value": 1,
                    "excess_value": 1,
                    "unit": "count",
                    "driver_fine_eur": None,
                    "company_fine_eur": None,
                    "status": "pending",
                    "severity": "MINOR",
                },
                {
                    "rule_id": "EU_165_MISSING_END_COUNTRY",
                    "category": "COUNTRY_ENTRY",
                    "title": titles["country_end"],
                    "legal_basis": "Art. 34(7) Regulation (EU) 165/2014",
                    "explanation": explanations["country_end"],
                    "start_time": t(20),
                    "end_time": t(20),
                    "measured_value": 0,
                    "allowed_value": 1,
                    "excess_value": 1,
                    "unit": "count",
                    "driver_fine_eur": None,
                    "company_fine_eur": None,
                    "status": "pending",
                    "severity": "MINOR",
                },
            ],
            "subtotal_driver_eur": None,
            "subtotal_company_eur": None,
        },
    ]

    return {
        "locale": locale,
        "engine_version": "test",
        "evaluated_at": t(0),
        "driver_id": driver_card,
        "summary": {
            "total": sum(len(s["rows"]) for s in sections),
            "by_category": {s["category"]: len(s["rows"]) for s in sections},
            "by_status": {"pending": sum(len(s["rows"]) for s in sections)},
            "by_severity": {},
            "driver_fine_total_eur": None,
            "company_fine_total_eur": None,
            "fine_unknown_count": sum(len(s["rows"]) for s in sections),
            "not_evaluable_rule_ids": [],
        },
        "sections": sections,
        "not_evaluable": [],
    }
