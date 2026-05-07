"""Render a signed-violation PDF and upload it to Dropbox.

Design goals (landscape, single page where possible):
  - A4 landscape (297×210 mm) so the violation table breathes horizontally.
  - Branded top band: company name + document type + driver block on one
    horizontal strip — dispatcher/auditor sees who-and-what at a glance.
  - Single-page typical case: 6 columns × ~14 rows of violations max.
  - Signature panel anchored on the right: signature image + signer name
    + signed-at timestamp + tamper-evident hash.

If reportlab is missing, the function raises a clean RuntimeError so the
HTTP layer surfaces a 503 rather than crashing.
"""

from __future__ import annotations

import base64
import io
import os
from datetime import datetime, timezone
from typing import Any, Mapping

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfgen.canvas import Canvas
    from reportlab.platypus import (
        BaseDocTemplate,
        Frame,
        Image,
        PageTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
    )
    HAS_REPORTLAB = True
    BRAND_DARK = colors.HexColor("#0a0b0e")
    BRAND_INK = colors.HexColor("#1d1d1f")
    BRAND_BLUE = colors.HexColor("#0071e3")
    BRAND_MUTED = colors.HexColor("#6b6b70")
    BRAND_LINE = colors.HexColor("#e5e5e7")
    BRAND_BG = colors.HexColor("#f5f5f7")
    BRAND_GREEN = colors.HexColor("#34c759")
except ImportError:  # pragma: no cover
    HAS_REPORTLAB = False

COMPANY_NAME = os.environ.get("COMPANY_NAME", "LTS Logistik GmbH")


# ----- localized chrome -----------------------------------------------------

_LOC = {
    "de": {
        "doc_title": "Verstoßprotokoll",
        "driver": "Fahrer",
        "card": "Karte",
        "period": "Zeitraum",
        "signed_at": "Signatur-Zeitpunkt",
        "remark": "Anmerkung des Fahrers",
        "signature": "Unterschrift",
        "no_violations": "Keine Verstöße im Bewertungszeitraum.",
        "col_kind": "Verstoß",
        "col_period": "Zeit",
        "col_measured": "Wert",
        "col_allowed": "Erlaubt",
        "col_severity": "Schwere",
        "col_rule": "Regel",
        "footer_left": "Bitte zur Kenntnis nehmen und unterschreiben.",
        "hash_label": "Dokument-Hash (SHA-256)",
    },
    "en": {
        "doc_title": "Violation report",
        "driver": "Driver",
        "card": "Card",
        "period": "Period",
        "signed_at": "Signed at",
        "remark": "Driver remark",
        "signature": "Signature",
        "no_violations": "No violations in the evaluated period.",
        "col_kind": "Violation",
        "col_period": "When",
        "col_measured": "Measured",
        "col_allowed": "Allowed",
        "col_severity": "Severity",
        "col_rule": "Rule",
        "footer_left": "Please review and sign.",
        "hash_label": "Document hash (SHA-256)",
    },
    "pl": {
        "doc_title": "Protokół naruszeń",
        "driver": "Kierowca",
        "card": "Karta",
        "period": "Okres",
        "signed_at": "Czas podpisu",
        "remark": "Uwagi kierowcy",
        "signature": "Podpis",
        "no_violations": "Brak naruszeń w analizowanym okresie.",
        "col_kind": "Naruszenie",
        "col_period": "Kiedy",
        "col_measured": "Zmierzone",
        "col_allowed": "Dozwolone",
        "col_severity": "Waga",
        "col_rule": "Reguła",
        "footer_left": "Prosimy o zapoznanie się i podpis.",
        "hash_label": "Hash dokumentu (SHA-256)",
    },
}


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
    """Render the signed PDF as raw bytes.

    Layout flows top-to-bottom inside one A4 landscape frame:
      [brand bar] [meta strip] [violation table] [signature + remark band]

    The function is self-contained — it does NOT call back into the
    compliance engine, so a regenerated PDF stays bit-identical given
    the same input.
    """
    if not HAS_REPORTLAB:
        raise RuntimeError(
            "reportlab not installed — `pip install reportlab` to enable signed PDF generation",
        )

    L = _LOC.get(locale, _LOC["de"])
    page_size = landscape(A4)
    page_w, page_h = page_size

    buf = io.BytesIO()

    # We use a custom page template so the brand bar can paint to the
    # absolute edges of the page; everything else stays inside a single
    # main frame with comfortable margins.
    margin_x = 12 * mm
    margin_top = 36 * mm   # leaves room for the brand bar drawn by onPage
    margin_bottom = 10 * mm
    frame_width = page_w - 2 * margin_x
    frame_height = page_h - margin_top - margin_bottom

    main_frame = Frame(
        margin_x,
        margin_bottom,
        frame_width,
        frame_height,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="main",
    )

    def _on_page(canvas: Canvas, _doc):
        _draw_brand_bar(
            canvas,
            page_w=page_w,
            page_h=page_h,
            title=L["doc_title"],
            driver_label=L["driver"],
            card_label=L["card"],
            driver_name=driver_name,
            driver_card=driver_card,
        )
        _draw_footer(
            canvas,
            page_w=page_w,
            page_h=page_h,
            left=L["footer_left"],
            right=f"{L['hash_label']}: {payload_hash}",
        )

    template = PageTemplate(id="default", frames=[main_frame], onPage=_on_page)
    doc = BaseDocTemplate(
        buf,
        pagesize=page_size,
        leftMargin=margin_x,
        rightMargin=margin_x,
        topMargin=margin_top,
        bottomMargin=margin_bottom,
        title=f"{L['doc_title']} — {driver_name or driver_card}",
        author=COMPANY_NAME,
    )
    doc.addPageTemplates([template])

    styles = _build_styles()
    elements: list[Any] = []

    # ---- meta strip: driver, period, signed date ----------------------------
    elements.append(_meta_strip(
        L=L,
        driver_name=driver_name,
        driver_card=driver_card,
        sections=payload.get("sections") or [],
        signed_at=signed_at,
        styles=styles,
        frame_width=frame_width,
    ))
    elements.append(Spacer(1, 4 * mm))

    # ---- violation table ----------------------------------------------------
    sections = payload.get("sections") or []
    if not sections:
        elements.append(Paragraph(L["no_violations"], styles["body"]))
    else:
        elements.append(_violation_table(sections, L=L, styles=styles, frame_width=frame_width))

    elements.append(Spacer(1, 5 * mm))

    # ---- signature band ----------------------------------------------------
    elements.append(_signature_band(
        signature_png_b64=signature_png_b64,
        signer_name=signer_name,
        signed_at=signed_at,
        driver_remark=driver_remark,
        L=L,
        styles=styles,
        frame_width=frame_width,
    ))

    doc.build(elements)
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# Brand bar / footer                                                          #
# --------------------------------------------------------------------------- #


def _draw_brand_bar(
    canvas: Canvas,
    *,
    page_w: float,
    page_h: float,
    title: str,
    driver_label: str,
    card_label: str,
    driver_name: str,
    driver_card: str,
) -> None:
    """Top brand band — full bleed, dark, with company name + doc title."""
    band_h = 26 * mm
    canvas.saveState()

    # band fill
    canvas.setFillColor(BRAND_DARK)
    canvas.rect(0, page_h - band_h, page_w, band_h, fill=1, stroke=0)

    # accent line under the band
    canvas.setFillColor(BRAND_BLUE)
    canvas.rect(0, page_h - band_h - 1.2, page_w, 1.2, fill=1, stroke=0)

    # left: company name + document title
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 16)
    canvas.drawString(12 * mm, page_h - 11 * mm, COMPANY_NAME)

    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(colors.HexColor("#9ca3af"))
    canvas.drawString(12 * mm, page_h - 16 * mm, title.upper())

    # right: driver block on the band, right-aligned
    right_x = page_w - 12 * mm
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 12)
    canvas.drawRightString(right_x, page_h - 11 * mm, driver_name or "—")

    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(colors.HexColor("#9ca3af"))
    canvas.drawRightString(
        right_x,
        page_h - 16 * mm,
        f"{driver_label}: {driver_name or '—'}   ·   {card_label}: {driver_card}",
    )

    canvas.restoreState()


def _draw_footer(
    canvas: Canvas,
    *,
    page_w: float,
    page_h: float,
    left: str,
    right: str,
) -> None:
    """Thin footer line: hint + tamper-evident hash."""
    canvas.saveState()
    canvas.setFillColor(BRAND_LINE)
    canvas.rect(12 * mm, 8 * mm, page_w - 24 * mm, 0.4, fill=1, stroke=0)

    canvas.setFillColor(BRAND_MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(12 * mm, 5 * mm, left)
    canvas.setFont("Courier", 6.5)
    canvas.drawRightString(page_w - 12 * mm, 5 * mm, right)
    canvas.restoreState()


# --------------------------------------------------------------------------- #
# Styles                                                                      #
# --------------------------------------------------------------------------- #


def _build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=10,
            textColor=BRAND_INK,
            spaceAfter=2,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            leading=11,
            textColor=BRAND_INK,
        ),
        "tiny": ParagraphStyle(
            "tiny",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9,
            textColor=BRAND_MUTED,
        ),
        "tableTitle": ParagraphStyle(
            "tableTitle",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=10,
            textColor=BRAND_INK,
        ),
        "tableLegal": ParagraphStyle(
            "tableLegal",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7,
            leading=8.5,
            textColor=BRAND_MUTED,
        ),
        "tableBody": ParagraphStyle(
            "tableBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9,
            textColor=BRAND_INK,
        ),
        "tableHead": ParagraphStyle(
            "tableHead",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=9,
            textColor=BRAND_INK,
        ),
        "metaLabel": ParagraphStyle(
            "metaLabel",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7,
            leading=8.5,
            textColor=BRAND_MUTED,
        ),
        "metaValue": ParagraphStyle(
            "metaValue",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=12,
            textColor=BRAND_INK,
        ),
    }


# --------------------------------------------------------------------------- #
# Sections                                                                    #
# --------------------------------------------------------------------------- #


def _meta_strip(
    *,
    L: Mapping[str, str],
    driver_name: str,
    driver_card: str,
    sections: list,
    signed_at: datetime,
    styles: Mapping[str, ParagraphStyle],
    frame_width: float,
) -> Table:
    """Three-cell meta strip directly under the brand bar."""
    period = _compute_period_str(sections)
    cells = [
        [
            Paragraph(L["driver"].upper(), styles["metaLabel"]),
            Paragraph(L["period"].upper(), styles["metaLabel"]),
            Paragraph(L["signed_at"].upper(), styles["metaLabel"]),
        ],
        [
            Paragraph(f"<b>{driver_name or driver_card}</b><br/><font size=7 color='#6b6b70'>{driver_card}</font>", styles["metaValue"]),
            Paragraph(period or "—", styles["metaValue"]),
            Paragraph(signed_at.astimezone().strftime("%Y-%m-%d %H:%M %Z"), styles["metaValue"]),
        ],
    ]
    col_w = frame_width / 3
    table = Table(cells, colWidths=[col_w] * 3, rowHeights=[5 * mm, 9 * mm])
    table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BRAND_BG),
            ("BOX", (0, 0), (-1, -1), 0, colors.transparent),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LINEAFTER", (0, 0), (0, -1), 0.4, BRAND_LINE),
            ("LINEAFTER", (1, 0), (1, -1), 0.4, BRAND_LINE),
        ]),
    )
    return table


def _compute_period_str(sections: list) -> str:
    """Earliest start → latest end across all rows. Empty when no rows."""
    starts: list[str] = []
    ends: list[str] = []
    for s in sections:
        for r in s.get("rows", []) or []:
            if r.get("start_time"):
                starts.append(str(r["start_time"]))
            if r.get("end_time"):
                ends.append(str(r["end_time"]))
    if not starts or not ends:
        return ""
    earliest = min(starts)[:10]
    latest = max(ends)[:10]
    if earliest == latest:
        return earliest
    return f"{earliest}  →  {latest}"


def _violation_table(
    sections: list,
    *,
    L: Mapping[str, str],
    styles: Mapping[str, ParagraphStyle],
    frame_width: float,
) -> Table:
    """Compact 6-column violation table.

    Each row is one violation. Sections are visually separated with a
    soft-tinted spanning band that carries the section heading.
    """
    head = [
        Paragraph(L["col_kind"], styles["tableHead"]),
        Paragraph(L["col_period"], styles["tableHead"]),
        Paragraph(L["col_measured"], styles["tableHead"]),
        Paragraph(L["col_allowed"], styles["tableHead"]),
        Paragraph(L["col_severity"], styles["tableHead"]),
        Paragraph(L["col_rule"], styles["tableHead"]),
    ]
    rows: list[list[Any]] = [head]
    section_band_indices: list[int] = []  # rows indices of section headers

    for section in sections:
        if not section.get("rows"):
            continue
        # section header row spans all columns
        section_band_indices.append(len(rows))
        rows.append([
            Paragraph(f"<b>{section.get('heading', '')}</b>  "
                      f"<font color='#6b6b70'>· {len(section['rows'])}</font>",
                      styles["tableBody"]),
            "", "", "", "", "",
        ])
        for row in section.get("rows", []):
            unit = row.get("unit", "")
            measured = _fmt_value(row.get("measured_value"), unit)
            allowed = _fmt_value(row.get("allowed_value"), unit)
            severity = row.get("severity") or "—"
            rule = str(row.get("rule_id", ""))
            start_t = str(row.get("start_time", ""))[:16].replace("T", " ")
            end_t = str(row.get("end_time", ""))[:16].replace("T", " ")
            rows.append([
                Paragraph(
                    f"<b>{row.get('title', '')}</b><br/>"
                    f"<font size=6.5 color='#6b6b70'>{row.get('legal_basis', '')}</font>",
                    styles["tableBody"],
                ),
                Paragraph(f"{start_t}<br/><font color='#6b6b70'>→ {end_t}</font>", styles["tableBody"]),
                Paragraph(f"<b>{measured}</b>", styles["tableBody"]),
                Paragraph(f"<font color='#6b6b70'>{allowed}</font>", styles["tableBody"]),
                Paragraph(severity, styles["tableBody"]),
                Paragraph(f"<font face='Courier' size=6.5>{rule}</font>", styles["tableBody"]),
            ])

    # Column widths sum to frame_width. Wide for kind, narrow for the rest.
    col_w = [
        frame_width * 0.30,  # kind
        frame_width * 0.18,  # period
        frame_width * 0.10,  # measured
        frame_width * 0.10,  # allowed
        frame_width * 0.10,  # severity
        frame_width * 0.22,  # rule
    ]

    style: list[Any] = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), BRAND_INK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, BRAND_LINE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, BRAND_LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    # Section header rows: span + tint
    for idx in section_band_indices:
        style.append(("SPAN", (0, idx), (-1, idx)))
        style.append(("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#fafafc")))
        style.append(("TOPPADDING", (0, idx), (-1, idx), 5))
        style.append(("BOTTOMPADDING", (0, idx), (-1, idx), 5))
        style.append(("LINEABOVE", (0, idx), (-1, idx), 0.5, BRAND_LINE))

    table = Table(rows, colWidths=col_w, repeatRows=1)
    table.setStyle(TableStyle(style))
    return table


def _signature_band(
    *,
    signature_png_b64: str,
    signer_name: str,
    signed_at: datetime,
    driver_remark: str | None,
    L: Mapping[str, str],
    styles: Mapping[str, ParagraphStyle],
    frame_width: float,
) -> Table:
    """Two-column band: remark on the left, signature on the right."""
    sig_image = _decode_signature_image(signature_png_b64)
    sig_cell: Any = sig_image if sig_image is not None else Paragraph("—", styles["body"])

    left = [
        [Paragraph(L["remark"].upper(), styles["metaLabel"])],
        [Paragraph(driver_remark or "—", styles["body"])],
    ]
    left_table = Table(left, colWidths=[frame_width * 0.55 - 6])
    left_table.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, BRAND_LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]),
    )

    right = [
        [Paragraph(L["signature"].upper(), styles["metaLabel"])],
        [sig_cell],
        [Paragraph(
            f"<b>{signer_name}</b><br/>"
            f"<font color='#6b6b70'>{signed_at.astimezone().strftime('%Y-%m-%d %H:%M %Z')}</font>",
            styles["body"],
        )],
    ]
    right_table = Table(right, colWidths=[frame_width * 0.45 - 6])
    right_table.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, BRAND_LINE),
            ("LINEBELOW", (0, 1), (0, 1), 0.3, BRAND_LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]),
    )

    band = Table(
        [[left_table, right_table]],
        colWidths=[frame_width * 0.55, frame_width * 0.45],
    )
    band.setStyle(
        TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]),
    )
    return band


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #


def _fmt_value(value: Any, unit: str) -> str:
    if value is None:
        return "—"
    unit_short = {
        "minutes": "min",
        "hours": "h",
        "days": "d",
        "count": "",
        "kilometers": "km",
    }.get(unit, unit or "")
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not value.is_integer():
            base = f"{value:.1f}"
        else:
            base = f"{int(value)}"
    else:
        base = str(value)
    return f"{base} {unit_short}".strip()


def _decode_signature_image(b64: str):  # noqa: ANN001
    """Decode a base64 PNG into a sized Image flowable.

    Sized so the signature panel fits its right column without overflow.
    Width 90 mm × height 28 mm — proportional, kind=proportional.
    """
    if not HAS_REPORTLAB:
        return None
    if not b64:
        return None
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    img = Image(io.BytesIO(raw), width=90 * mm, height=28 * mm, kind="proportional")
    img.hAlign = "LEFT"
    return img


# --------------------------------------------------------------------------- #
# Dropbox upload                                                              #
# --------------------------------------------------------------------------- #


def upload_signed_pdf_to_dropbox(
    *,
    pdf_bytes: bytes,
    driver_card: str,
    driver_name: str,
    signed_at: datetime,
    token: str,
) -> str:
    """Upload `pdf_bytes` to Dropbox under /<folder>/<driver>/<file>.

    Re-uses the project's existing Dropbox client.
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
    "COMPANY_NAME",
]
