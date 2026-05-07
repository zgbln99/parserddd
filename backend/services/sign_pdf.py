"""Render a signed-violation PDF and upload it to Dropbox.

Design goals:
  - Clean letterhead (no aggressive brand band) — looks like a real
    business document, not a marketing flyer.
  - Single page in landscape A4 for the typical case (~14 violations).
  - Polish / German / English diacritics MUST render correctly. We
    register DejaVu Sans (ships on virtually every Linux distro) at
    module load and use it everywhere. Helvetica fallback only when
    DejaVu can't be found — Polish characters then degrade to ■.
  - No "Rule" column in the violations table — the rule_id is internal
    plumbing the driver doesn't need to see.
"""

from __future__ import annotations

import base64
import io
import logging
import os
from datetime import datetime, timezone
from typing import Any, Mapping

_log = logging.getLogger(__name__)

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
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
    INK = colors.HexColor("#0a0b0e")
    INK_SOFT = colors.HexColor("#1d1d1f")
    MUTED = colors.HexColor("#6b6b70")
    LINE = colors.HexColor("#e5e5e7")
    BG = colors.HexColor("#fafafc")
    SEV_HIGH_BG = colors.HexColor("#fee2e2")
    SEV_HIGH_FG = colors.HexColor("#9f1239")
    SEV_MED_BG = colors.HexColor("#fef3c7")
    SEV_MED_FG = colors.HexColor("#92400e")
    SEV_LOW_BG = colors.HexColor("#dcfce7")
    SEV_LOW_FG = colors.HexColor("#166534")
except ImportError:  # pragma: no cover
    HAS_REPORTLAB = False


COMPANY_NAME = os.environ.get("COMPANY_NAME", "LTS Logistik GmbH")


# --------------------------------------------------------------------------- #
# Font registration                                                           #
# --------------------------------------------------------------------------- #
#
# `Helvetica` (built into reportlab) covers ASCII + a handful of Western
# European glyphs but is missing Polish ą ę ł ń ó ś ź ż, plus most of the
# extended Latin range. Without a Unicode font we render filled-square
# tofu. We register DejaVu Sans (LGPL-style license, included by default
# on Debian/Ubuntu/Fedora/Alpine) at import time and use it everywhere.
#
# If DejaVu isn't installed we log a warning and fall back to Helvetica —
# the PDF still renders, just with degraded Polish support.

_FONT_REGULAR = "Helvetica"
_FONT_BOLD = "Helvetica-Bold"
_FONT_MONO = "Courier"


def _register_unicode_fonts() -> None:
    """Register DejaVu Sans family if available. Idempotent + best-effort."""
    global _FONT_REGULAR, _FONT_BOLD
    if not HAS_REPORTLAB:
        return

    candidates = [
        # path_regular, path_bold, name_regular, name_bold
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ),
        (
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        ),
        (
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        ),
        (
            "/Library/Fonts/DejaVuSans.ttf",
            "/Library/Fonts/DejaVuSans-Bold.ttf",
        ),
    ]
    for regular, bold in candidates:
        if not (os.path.exists(regular) and os.path.exists(bold)):
            continue
        try:
            pdfmetrics.registerFont(TTFont("DejaVuSans", regular))
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", bold))
            _FONT_REGULAR = "DejaVuSans"
            _FONT_BOLD = "DejaVuSans-Bold"
            return
        except Exception as exc:
            _log.warning("Could not register %s/%s: %s", regular, bold, exc)
            continue
    _log.warning(
        "DejaVu Sans not found — PDF will use Helvetica and may show □ for "
        "Polish/extended Latin characters. Install fonts-dejavu-core to fix.",
    )


_register_unicode_fonts()


# --------------------------------------------------------------------------- #
# Localized chrome                                                            #
# --------------------------------------------------------------------------- #


_LOC = {
    "de": {
        "doc_title": "Verstoßprotokoll",
        "driver": "Fahrer",
        "card": "Karte",
        "period": "Zeitraum",
        "signed_at": "Unterzeichnet am",
        "remark": "Anmerkung des Fahrers",
        "signature": "Unterschrift",
        "no_violations": "Keine Verstöße im Bewertungszeitraum.",
        "col_kind": "Verstoß",
        "col_period": "Zeit",
        "col_measured": "Gemessen",
        "col_allowed": "Erlaubt",
        "col_severity": "Schwere",
        "footer_left": "Bitte zur Kenntnis nehmen und unterschreiben.",
        "hash_label": "Dokument-Hash",
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
        "footer_left": "Please review and sign.",
        "hash_label": "Document hash",
    },
    "pl": {
        "doc_title": "Protokół naruszeń",
        "driver": "Kierowca",
        "card": "Karta",
        "period": "Okres",
        "signed_at": "Podpisano",
        "remark": "Uwagi kierowcy",
        "signature": "Podpis",
        "no_violations": "Brak naruszeń w analizowanym okresie.",
        "col_kind": "Naruszenie",
        "col_period": "Kiedy",
        "col_measured": "Zmierzone",
        "col_allowed": "Dozwolone",
        "col_severity": "Waga",
        "footer_left": "Prosimy o zapoznanie się i podpis.",
        "hash_label": "Hash dokumentu",
    },
}


_SEVERITY_LOC = {
    "de": {
        "MOST_SERIOUS": "Sehr schwer",
        "VERY_SERIOUS": "Schwer",
        "SERIOUS": "Erheblich",
        "MINOR": "Gering",
    },
    "en": {
        "MOST_SERIOUS": "Most serious",
        "VERY_SERIOUS": "Very serious",
        "SERIOUS": "Serious",
        "MINOR": "Minor",
    },
    "pl": {
        "MOST_SERIOUS": "Bardzo poważne",
        "VERY_SERIOUS": "Poważne",
        "SERIOUS": "Istotne",
        "MINOR": "Drobne",
    },
}


# --------------------------------------------------------------------------- #
# Public API                                                                  #
# --------------------------------------------------------------------------- #


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
    """Render the signed PDF as raw bytes."""
    if not HAS_REPORTLAB:
        raise RuntimeError(
            "reportlab not installed — `pip install reportlab` to enable signed PDF generation",
        )

    L = _LOC.get(locale, _LOC["de"])
    page_size = landscape(A4)
    page_w, page_h = page_size

    buf = io.BytesIO()

    margin_x = 14 * mm
    margin_top = 30 * mm   # space for the (clean, light) letterhead
    margin_bottom = 12 * mm
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
        _draw_letterhead(
            canvas,
            page_w=page_w,
            page_h=page_h,
            margin_x=margin_x,
            doc_title=L["doc_title"],
            driver_name=driver_name,
            driver_card=driver_card,
            driver_label=L["driver"],
            card_label=L["card"],
        )
        _draw_footer(
            canvas,
            page_w=page_w,
            margin_x=margin_x,
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

    elements.append(_meta_strip(
        L=L,
        driver_name=driver_name,
        driver_card=driver_card,
        sections=payload.get("sections") or [],
        signed_at=signed_at,
        styles=styles,
        frame_width=frame_width,
    ))
    elements.append(Spacer(1, 5 * mm))

    sections = payload.get("sections") or []
    if not sections:
        elements.append(Paragraph(L["no_violations"], styles["body"]))
    else:
        elements.append(_violation_table(
            sections,
            L=L,
            locale=locale,
            styles=styles,
            frame_width=frame_width,
        ))

    elements.append(Spacer(1, 6 * mm))

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
# Letterhead + footer                                                         #
# --------------------------------------------------------------------------- #


def _draw_letterhead(
    canvas: Canvas,
    *,
    page_w: float,
    page_h: float,
    margin_x: float,
    doc_title: str,
    driver_name: str,
    driver_card: str,
    driver_label: str,
    card_label: str,
) -> None:
    """Clean letterhead — no full-bleed band, just typography + a hairline.

    Left: company name (large, dark) and document title (caps, muted).
    Right: driver name (right-aligned, dark) and card details (muted).
    A 0.6 pt hairline at y = page_h - 30mm separates the head from the body.
    """
    canvas.saveState()

    # Left block
    canvas.setFillColor(INK)
    canvas.setFont(_FONT_BOLD, 17)
    canvas.drawString(margin_x, page_h - 13 * mm, COMPANY_NAME)

    canvas.setFillColor(MUTED)
    canvas.setFont(_FONT_REGULAR, 8.5)
    canvas.drawString(
        margin_x,
        page_h - 18.5 * mm,
        doc_title.upper(),
    )

    # Right block
    right_x = page_w - margin_x
    canvas.setFillColor(INK)
    canvas.setFont(_FONT_BOLD, 13)
    canvas.drawRightString(right_x, page_h - 13 * mm, driver_name or "—")

    canvas.setFillColor(MUTED)
    canvas.setFont(_FONT_REGULAR, 8.5)
    canvas.drawRightString(
        right_x,
        page_h - 18.5 * mm,
        f"{driver_label}: {driver_name or '—'}   ·   {card_label}: {driver_card}",
    )

    # Hairline separator
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(
        margin_x,
        page_h - 23 * mm,
        page_w - margin_x,
        page_h - 23 * mm,
    )

    canvas.restoreState()


def _draw_footer(
    canvas: Canvas,
    *,
    page_w: float,
    margin_x: float,
    left: str,
    right: str,
) -> None:
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.4)
    canvas.line(margin_x, 9 * mm, page_w - margin_x, 9 * mm)

    canvas.setFillColor(MUTED)
    canvas.setFont(_FONT_REGULAR, 7.5)
    canvas.drawString(margin_x, 5.5 * mm, left)
    canvas.setFont(_FONT_MONO, 6.8)
    canvas.drawRightString(page_w - margin_x, 5.5 * mm, right)
    canvas.restoreState()


# --------------------------------------------------------------------------- #
# Styles                                                                      #
# --------------------------------------------------------------------------- #


def _build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName=_FONT_REGULAR,
            fontSize=9,
            leading=11.5,
            textColor=INK_SOFT,
        ),
        "tableTitle": ParagraphStyle(
            "tableTitle",
            parent=base["BodyText"],
            fontName=_FONT_BOLD,
            fontSize=9,
            leading=11,
            textColor=INK,
            spaceAfter=2,
        ),
        "tableLegal": ParagraphStyle(
            "tableLegal",
            parent=base["BodyText"],
            fontName=_FONT_REGULAR,
            fontSize=7,
            leading=8.5,
            textColor=MUTED,
        ),
        "tableBody": ParagraphStyle(
            "tableBody",
            parent=base["BodyText"],
            fontName=_FONT_REGULAR,
            fontSize=8,
            leading=10,
            textColor=INK_SOFT,
        ),
        "tableNum": ParagraphStyle(
            "tableNum",
            parent=base["BodyText"],
            fontName=_FONT_BOLD,
            fontSize=9,
            leading=11,
            textColor=INK,
            alignment=0,
        ),
        "tableNumMuted": ParagraphStyle(
            "tableNumMuted",
            parent=base["BodyText"],
            fontName=_FONT_REGULAR,
            fontSize=9,
            leading=11,
            textColor=MUTED,
            alignment=0,
        ),
        "tableHead": ParagraphStyle(
            "tableHead",
            parent=base["BodyText"],
            fontName=_FONT_BOLD,
            fontSize=7.5,
            leading=9,
            textColor=MUTED,
        ),
        "metaLabel": ParagraphStyle(
            "metaLabel",
            parent=base["BodyText"],
            fontName=_FONT_BOLD,
            fontSize=7,
            leading=9,
            textColor=MUTED,
        ),
        "metaValue": ParagraphStyle(
            "metaValue",
            parent=base["BodyText"],
            fontName=_FONT_BOLD,
            fontSize=10.5,
            leading=12.5,
            textColor=INK,
        ),
        "metaSub": ParagraphStyle(
            "metaSub",
            parent=base["BodyText"],
            fontName=_FONT_REGULAR,
            fontSize=8,
            leading=10,
            textColor=MUTED,
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
    period = _compute_period_str(sections)
    cells = [
        [
            Paragraph(L["driver"].upper(), styles["metaLabel"]),
            Paragraph(L["period"].upper(), styles["metaLabel"]),
            Paragraph(L["signed_at"].upper(), styles["metaLabel"]),
        ],
        [
            Paragraph(driver_name or driver_card, styles["metaValue"]),
            Paragraph(period or "—", styles["metaValue"]),
            Paragraph(
                signed_at.astimezone().strftime("%Y-%m-%d %H:%M %Z"),
                styles["metaValue"],
            ),
        ],
        [
            Paragraph(driver_card, styles["metaSub"]),
            Paragraph("", styles["metaSub"]),
            Paragraph("", styles["metaSub"]),
        ],
    ]
    col_w = frame_width / 3
    table = Table(cells, colWidths=[col_w] * 3, rowHeights=[5 * mm, 7 * mm, 5 * mm])
    table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BG),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LINEAFTER", (0, 0), (0, -1), 0.4, LINE),
            ("LINEAFTER", (1, 0), (1, -1), 0.4, LINE),
        ]),
    )
    return table


def _compute_period_str(sections: list) -> str:
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


def _severity_pill(severity: str | None, locale: str) -> tuple[str, Any, Any] | None:
    """(localized text, bg color, fg color) for a severity, or None for no pill."""
    if not severity:
        return None
    s = severity.upper()
    label = _SEVERITY_LOC.get(locale, _SEVERITY_LOC["de"]).get(s, severity)
    if s in ("MOST_SERIOUS", "VERY_SERIOUS"):
        return label, SEV_HIGH_BG, SEV_HIGH_FG
    if s == "SERIOUS":
        return label, SEV_MED_BG, SEV_MED_FG
    return label, SEV_LOW_BG, SEV_LOW_FG


def _violation_table(
    sections: list,
    *,
    L: Mapping[str, str],
    locale: str,
    styles: Mapping[str, ParagraphStyle],
    frame_width: float,
) -> Table:
    """5-column violation table — Rule column dropped on purpose."""
    head = [
        Paragraph(L["col_kind"], styles["tableHead"]),
        Paragraph(L["col_period"], styles["tableHead"]),
        Paragraph(L["col_measured"], styles["tableHead"]),
        Paragraph(L["col_allowed"], styles["tableHead"]),
        Paragraph(L["col_severity"], styles["tableHead"]),
    ]
    rows: list[list[Any]] = [head]
    section_band_indices: list[int] = []
    severity_cells: list[tuple[int, str, Any, Any]] = []  # (row_idx, label, bg, fg)

    for section in sections:
        if not section.get("rows"):
            continue
        section_band_indices.append(len(rows))
        rows.append([
            Paragraph(
                f"<b>{section.get('heading', '')}</b>"
                f"  <font color='#9ca3af' size='8'>· {len(section['rows'])}</font>",
                styles["tableBody"],
            ),
            "", "", "", "",
        ])
        for row in section.get("rows", []):
            unit = row.get("unit", "")
            measured = _fmt_value(row.get("measured_value"), unit)
            allowed = _fmt_value(row.get("allowed_value"), unit)
            start_t = str(row.get("start_time", ""))[:16].replace("T", " ")
            end_t = str(row.get("end_time", ""))[:16].replace("T", " ")
            sev = _severity_pill(row.get("severity"), locale)

            rows.append([
                Paragraph(
                    f"<b>{row.get('title', '')}</b><br/>"
                    f"<font color='#6b6b70' size='7'>{row.get('legal_basis', '')}</font>",
                    styles["tableBody"],
                ),
                Paragraph(
                    f"{start_t}<br/><font color='#6b6b70'>→ {end_t}</font>",
                    styles["tableBody"],
                ),
                Paragraph(measured, styles["tableNum"]),
                Paragraph(allowed, styles["tableNumMuted"]),
                # Filled later via setStyle after we know the row index
                Paragraph(
                    f"  {sev[0] if sev else '—'}  ",
                    ParagraphStyle(
                        "sev",
                        parent=styles["tableBody"],
                        fontName=_FONT_BOLD,
                        fontSize=7.5,
                        leading=9.5,
                        textColor=sev[2] if sev else MUTED,
                        alignment=0,
                    ),
                ),
            ])
            if sev is not None:
                severity_cells.append((len(rows) - 1, sev[0], sev[1], sev[2]))

    col_w = [
        frame_width * 0.42,  # kind
        frame_width * 0.20,  # period
        frame_width * 0.13,  # measured
        frame_width * 0.13,  # allowed
        frame_width * 0.12,  # severity
    ]

    style: list[Any] = [
        ("BACKGROUND", (0, 0), (-1, 0), BG),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]

    # Section header rows: span all 5 columns + subtle background
    for idx in section_band_indices:
        style.append(("SPAN", (0, idx), (-1, idx)))
        style.append(("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#f6f7f9")))
        style.append(("LINEABOVE", (0, idx), (-1, idx), 0.5, LINE))
        style.append(("TOPPADDING", (0, idx), (-1, idx), 5))
        style.append(("BOTTOMPADDING", (0, idx), (-1, idx), 5))

    # Severity cell tint
    for row_idx, _label, bg, _fg in severity_cells:
        style.append(("BACKGROUND", (4, row_idx), (4, row_idx), bg))
        style.append(("LEFTPADDING", (4, row_idx), (4, row_idx), 6))
        style.append(("RIGHTPADDING", (4, row_idx), (4, row_idx), 6))

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
    sig_image = _decode_signature_image(signature_png_b64)
    sig_cell: Any = sig_image if sig_image is not None else Paragraph("—", styles["body"])

    left = [
        [Paragraph(L["remark"].upper(), styles["metaLabel"])],
        [Paragraph(driver_remark or "—", styles["body"])],
    ]
    left_table = Table(left, colWidths=[frame_width * 0.55 - 6])
    left_table.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
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
            ("BOX", (0, 0), (-1, -1), 0.4, LINE),
            ("LINEBELOW", (0, 1), (0, 1), 0.3, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
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
    """Format a measurement for display.

    Minutes get auto-converted to hours when >= 60:
        90  → "1h 30min"
        300 → "5h"
        12  → "12 min"
    Other units keep their natural form.
    """
    if value is None:
        return "—"
    if unit == "minutes" and isinstance(value, (int, float)):
        total = int(round(value))
        if total < 60:
            return f"{total} min"
        h, m = divmod(total, 60)
        if m == 0:
            return f"{h}h"
        return f"{h}h {m}min"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not value.is_integer():
            base = f"{value:.1f}"
        else:
            base = f"{int(value)}"
    else:
        base = str(value)
    suffix = {
        "hours": "h",
        "days": "d",
        "count": "",
        "kilometers": "km",
    }.get(unit, unit or "")
    return f"{base} {suffix}".strip()


def _decode_signature_image(b64: str):  # noqa: ANN001
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
