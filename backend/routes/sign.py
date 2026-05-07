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
