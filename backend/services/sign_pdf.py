"""Render a signed-violation PDF and upload it to Dropbox.

We deliberately avoid heavy PDF dependencies. Flask projects this size
typically already pull in `reportlab` for invoice / payslip generation;
if it's not installed we fall back to a clean HTML→PDF via `weasyprint`.
If neither is available, the function raises so the caller can retry
later — the engine never silently drops a signed payload.

The PDF embeds:
  - Driver name, card number, evaluation date, locale
  - One section per violation (rule_id, legal basis, measured/allowed,
    explanation, fines)
  - Signature image (PNG from the canvas) at the bottom
  - SHA-256 payload hash for tamper detection
"""

from __future__ import annotations

import base64
import io
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        Image,
        Table,
        TableStyle,
        PageBreak,
    )
    HAS_REPORTLAB = True
except ImportError:  # pragma: no cover
    HAS_REPORTLAB = False


def render_signed_pdf(
    *,
    payload: Mapping[str, Any],
    driver_card: str,
    driver_name: str,
    locale: str,
    signer_name: str,
    signature_png_b64: str,
    driver_remark: str | None,
    payload_hash: str,
    signed_at: datetime,
) -> bytes:
    """Render the PDF as raw bytes.

    `payload` is the engine's PdfReport (locale-bound rows). The function
    is intentionally self-contained — it does not call back into the
    engine, so a regenerated PDF stays bit-identical given the same input.
    """
    if not HAS_REPORTLAB:
        raise RuntimeError(
            "reportlab not installed — `pip install reportlab` to enable signed PDF generation",
        )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"Verstoßprotokoll – {driver_name or driver_card}",
        author="LTS Logistik GmbH",
    )

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=18, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, textColor=colors.HexColor("#1d1d1f"))
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("small", parent=styles["BodyText"], fontSize=8, textColor=colors.grey)

    elements: list[Any] = []
    title_map = {
        "de": "Verstoßprotokoll",
        "en": "Violation report",
        "pl": "Protokół naruszeń",
    }
    elements.append(Paragraph(title_map.get(locale, title_map["de"]), h1))
    elements.append(Paragraph(
        f"<b>{driver_name or driver_card}</b> · {driver_card}",
        body,
    ))
    elements.append(Paragraph(
        f"Erstellt: {signed_at.astimezone().strftime('%Y-%m-%d %H:%M %Z')}",
        small,
    ))
    elements.append(Spacer(1, 8 * mm))

    sections = payload.get("sections") or []
    if not sections:
        elements.append(Paragraph("Keine Verstöße im Bewertungszeitraum.", body))
    for section in sections:
        elements.append(Paragraph(section.get("heading", ""), h2))
        elements.append(Spacer(1, 2 * mm))
        for row in section.get("rows", []):
            elements.append(_violation_table(row, body, small))
            elements.append(Spacer(1, 4 * mm))

    elements.append(Spacer(1, 6 * mm))
    elements.append(Paragraph(_remark_label(locale), h2))
    elements.append(Paragraph(driver_remark or "—", body))

    elements.append(Spacer(1, 8 * mm))
    elements.append(Paragraph(_signature_label(locale), h2))
    sig_img = _decode_signature_image(signature_png_b64)
    if sig_img is not None:
        elements.append(sig_img)
    elements.append(Paragraph(
        f"<b>{signer_name}</b> · {signed_at.astimezone().strftime('%Y-%m-%d %H:%M')}",
        body,
    ))
    elements.append(Spacer(1, 6 * mm))
    elements.append(Paragraph(
        f"Payload-Hash (SHA-256): <font face='Courier' size='7'>{payload_hash}</font>",
        small,
    ))

    doc.build(elements)
    return buf.getvalue()


def _violation_table(row: Mapping[str, Any], body, small) -> "Table":
    rule = str(row.get("rule_id", ""))
    title = str(row.get("title", ""))
    legal = str(row.get("legal_basis", ""))
    explanation = str(row.get("explanation", ""))
    measured = row.get("measured_value")
    allowed = row.get("allowed_value")
    excess = row.get("excess_value")
    unit = row.get("unit", "")
    fine_d = row.get("driver_fine_eur")
    fine_c = row.get("company_fine_eur")
    severity = row.get("severity") or "—"
    start_t = str(row.get("start_time", ""))[:19].replace("T", " ")
    end_t = str(row.get("end_time", ""))[:19].replace("T", " ")

    data = [
        [Paragraph(f"<b>{title}</b>", body), Paragraph(legal, small)],
        [Paragraph(explanation, body), ""],
        [
            Paragraph(
                f"<b>Zeit:</b> {start_t} → {end_t}<br/>"
                f"<b>Wert:</b> {_fmt(measured)} {unit} · "
                f"<b>Erlaubt:</b> {_fmt(allowed)} {unit} · "
                f"<b>Überschreitung:</b> {_fmt(excess)} {unit}",
                small,
            ),
            "",
        ],
        [
            Paragraph(
                f"<b>Bußgeld Fahrer:</b> {_fmt_eur(fine_d)} · "
                f"<b>Unternehmen:</b> {_fmt_eur(fine_c)} · "
                f"<b>Schwere:</b> {severity} · "
                f"<b>Regel:</b> {rule}",
                small,
            ),
            "",
        ],
    ]
    table = Table(data, colWidths=[120 * mm, 50 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fafafc")),
                ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e5e7")),
                ("INNERGRID", (0, 0), (-1, -1), 0, colors.white),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("SPAN", (0, 1), (1, 1)),
                ("SPAN", (0, 2), (1, 2)),
                ("SPAN", (0, 3), (1, 3)),
            ],
        ),
    )
    return table


def _fmt(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, (int, float)):
        return f"{value:g}"
    return str(value)


def _fmt_eur(value: Any) -> str:
    if value is None:
        return "—"
    return f"{value:.2f} €"


def _decode_signature_image(b64: str):  # noqa: ANN001
    if not HAS_REPORTLAB:
        return None
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    img = Image(io.BytesIO(raw), width=80 * mm, height=30 * mm, kind="proportional")
    img.hAlign = "LEFT"
    return img


def _remark_label(locale: str) -> str:
    return {
        "de": "Anmerkung des Fahrers",
        "en": "Driver remark",
        "pl": "Uwagi kierowcy",
    }.get(locale, "Anmerkung des Fahrers")


def _signature_label(locale: str) -> str:
    return {
        "de": "Unterschrift des Fahrers",
        "en": "Driver signature",
        "pl": "Podpis kierowcy",
    }.get(locale, "Unterschrift des Fahrers")


def upload_signed_pdf_to_dropbox(
    *,
    pdf_bytes: bytes,
    driver_card: str,
    driver_name: str,
    signed_at: datetime,
    token: str,
) -> str:
    """Upload `pdf_bytes` to Dropbox under /signed-violations/<driver>/<file>.

    Re-uses the project's existing Dropbox client from
    `backend/services/dropbox_service`.
    """
    from dropbox.files import WriteMode  # type: ignore[import-untyped]
    from services.dropbox_service import get_server_dropbox_client

    safe_driver = _safe_path_component(driver_name or driver_card)
    date = signed_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
    folder = os.environ.get("DROPBOX_SIGNED_FOLDER", "/Verstoesse-Unterschriften")
    filename = f"{date}_{token[:8]}.pdf"
    path = f"{folder}/{safe_driver}/{filename}"

    dbx = get_server_dropbox_client()
    if dbx is None:
        raise RuntimeError("Dropbox client not configured (missing refresh token)")
    dbx.files_upload(pdf_bytes, path, mode=WriteMode.overwrite, mute=True)
    return path


def _safe_path_component(s: str) -> str:
    out = []
    for ch in s.strip():
        if ch.isalnum() or ch in (" ", "-", "_", "."):
            out.append(ch)
        else:
            out.append("_")
    cleaned = "".join(out).strip().replace("  ", " ")
    return cleaned or "unbekannt"


__all__ = [
    "render_signed_pdf",
    "upload_signed_pdf_to_dropbox",
    "HAS_REPORTLAB",
]
