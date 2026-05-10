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


_DISCLAIMER = {
    "de": (
        "Der/Die unterzeichnete Fahrer/Fahrerin bestätigt hiermit, dass er/sie "
        "über die hier aufgelisteten Verstöße in Kenntnis gesetzt wurde und dass "
        "er/sie belehrt und aufgefordert wurde, zukünftig die gesetzlichen "
        "Lenk- und Ruhezeiten sowie die Bestimmungen des Arbeitszeitgesetzes "
        "einzuhalten."
    ),
    "en": (
        "The undersigned driver hereby confirms that they have been informed "
        "of the violations listed here and have been instructed to comply with "
        "statutory driving / rest times and working-time regulations going forward."
    ),
    "pl": (
        "Niżej podpisany kierowca potwierdza, że został(a) zapoznany(a) z "
        "wymienionymi powyżej naruszeniami oraz pouczony(a) o obowiązku "
        "przestrzegania ustawowych norm czasu jazdy, przerw i odpoczynków oraz "
        "przepisów ustawy o czasie pracy."
    ),
}


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
        "col_what": "Was passierte",
        "col_severity": "Schwere",
        "footer_left": "Bitte zur Kenntnis nehmen und unterschreiben.",
        "hash_label": "Dokument-Hash",
        "sig_driver": "Unterschrift Fahrer/Fahrerin",
        "sig_responsible": "Unterschrift Verantwortlicher",
        "sig_place_date": "Ort, Datum",
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
        "col_what": "What happened",
        "col_severity": "Severity",
        "footer_left": "Please review and sign.",
        "hash_label": "Document hash",
        "sig_driver": "Driver signature",
        "sig_responsible": "Responsible person signature",
        "sig_place_date": "Place, date",
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
        "col_what": "Co się stało",
        "col_severity": "Waga",
        "footer_left": "Prosimy o zapoznanie się i podpis.",
        "hash_label": "Hash dokumentu",
        "sig_driver": "Podpis kierowcy",
        "sig_responsible": "Podpis osoby odpowiedzialnej",
        "sig_place_date": "Miejscowość, data",
    },
}


def _describe_incident(row: Mapping[str, Any], locale: str) -> str:
    """Plain-language sentence describing what the driver actually did wrong.

    Mirrors the frontend's describeIncident() so the driver sees the same
    wording on the web page and in the PDF.
    """
    rule_id = str(row.get("rule_id", ""))
    unit = row.get("unit", "")
    m = row.get("measured_value")
    a = row.get("allowed_value")
    is_time = unit in ("minutes", "hours", "days")

    L = locale if locale in ("de", "en", "pl") else "de"

    # ---- Rule-specific structural sentences --------------------------
    static = {
        "EU_165_MISSING_START_COUNTRY": {
            "de": "Kein Land bei Schichtbeginn in den Tachograph eingegeben.",
            "en": "No country entered into the tachograph at shift start.",
            "pl": "Nie wpisano kraju w tachografie przy rozpoczęciu zmiany.",
        },
        "EU_165_MISSING_END_COUNTRY": {
            "de": "Kein Land bei Schichtende in den Tachograph eingegeben.",
            "en": "No country entered into the tachograph at shift end.",
            "pl": "Nie wpisano kraju w tachografie przy zakończeniu zmiany.",
        },
        "EU_165_MISSING_MANUAL_ENTRY": {
            "de": "Zeitraum mit gezogener Karte ohne manuellen Nachtrag.",
            "en": "Card-out period not back-filled with a manual entry.",
            "pl": "Okres bez karty nie uzupełniony wpisem manualnym.",
        },
        "EU_165_INCOMPLETE_MANUAL_ENTRY": {
            "de": "Manueller Nachtrag wurde unvollständig ausgefüllt.",
            "en": "Manual entry was filed but is incomplete.",
            "pl": "Wpis manualny złożony, ale niekompletny.",
        },
        "EU_165_DRIVING_WITHOUT_CARD": {
            "de": "Fahrzeug bewegt, ohne dass eine Fahrerkarte gesteckt war.",
            "en": "Vehicle was driven without an inserted driver card.",
            "pl": "Pojazd jechał bez włożonej karty kierowcy.",
        },
        "EU_165_CARD_REMOVED_TOO_EARLY": {
            "de": "Fahrerkarte vor Schichtende entnommen.",
            "en": "Driver card removed before the shift ended.",
            "pl": "Karta kierowcy wyjęta przed zakończeniem zmiany.",
        },
        "EU_165_WRONG_SLOT": {
            "de": "Fahrt im Beifahrer-Schacht statt im Fahrer-Schacht aufgezeichnet.",
            "en": "Driving recorded under co-driver slot instead of driver slot.",
            "pl": "Jazdę zapisano w slocie pasażera zamiast kierowcy.",
        },
        "EU_165_MISSING_CO_DRIVER": {
            "de": "Mehrfahrerbetrieb angegeben, aber nur eine Karte gesteckt.",
            "en": "Multi-manning declared but only one card inserted.",
            "pl": "Załoga podwójna zadeklarowana, ale w slotach tylko jedna karta.",
        },
        "EU_165_REST_DURING_WORK": {
            "de": "Aktivität als Ruhe gewählt, während gearbeitet wurde.",
            "en": "Activity selected as rest while actually working.",
            "pl": "Wybrano odpoczynek jako aktywność w trakcie pracy.",
        },
        "EU_165_OUT_MISUSE": {
            "de": "OUT-Modus aktiviert, obwohl die Fahrt unter EU 561 fiel.",
            "en": "OUT mode used on a trip that should have been recorded.",
            "pl": "Włączono tryb OUT na trasie, która powinna być rejestrowana.",
        },
        "EU_165_AVAILABILITY_INSTEAD_OF_WORK": {
            "de": "Bereitschaft markiert, obwohl tatsächlich gearbeitet wurde (z. B. Beladen).",
            "en": "Availability selected while actually working (loading, etc.).",
            "pl": "Wybrano dyspozycyjność zamiast pracy (np. załadunek).",
        },
    }
    if rule_id in static:
        return static[rule_id][L]

    if not (is_time and isinstance(m, (int, float)) and isinstance(a, (int, float))):
        return str(row.get("explanation", "") or "")

    measured = _fmt_value(m, unit)
    allowed = _fmt_value(a, unit)
    category = str(row.get("category", ""))

    if m > a > 0:
        excess = _fmt_value(m - a, unit)
        templates = {
            "BREAKS": {
                "de": f"{measured} am Stück gefahren, ohne die vorgeschriebene 45-Min-Pause einzulegen.",
                "en": f"Drove {measured} continuously without taking the required 45-min break.",
                "pl": f"Jazda ciągła {measured} bez wymaganej 45-min przerwy.",
            },
            "DRIVING_TIME": {
                "de": f"Lenkzeit {measured} statt zulässiger {allowed} — {excess} zu viel.",
                "en": f"Drove {measured} instead of the {allowed} maximum — {excess} over.",
                "pl": f"Czas jazdy {measured} zamiast dozwolonych {allowed} — o {excess} za dużo.",
            },
            "WORKING_TIME": {
                "de": f"Arbeitszeit {measured} statt zulässiger {allowed} — {excess} zu viel.",
                "en": f"Worked {measured} instead of the {allowed} maximum — {excess} over.",
                "pl": f"Czas pracy {measured} zamiast dozwolonych {allowed} — o {excess} za dużo.",
            },
            "NIGHT_WORK": {
                "de": f"Nachtarbeitstag mit {measured} Arbeit (zulässig {allowed}).",
                "en": f"Night-work day with {measured} of work (allowed {allowed}).",
                "pl": f"Dzień z pracą nocną i {measured} pracy (dozwolone {allowed}).",
            },
        }
        if category in templates:
            return templates[category][L]

    if 0 < m < a:
        shortfall = _fmt_value(a - m, unit)
        if category == "REST":
            templates = {
                "de": f"Ruhezeit nur {measured} statt erforderlicher {allowed} — {shortfall} zu kurz.",
                "en": f"Rest only {measured} instead of the required {allowed} — {shortfall} short.",
                "pl": f"Odpoczynek tylko {measured} zamiast wymaganych {allowed} — brakuje {shortfall}.",
            }
            return templates[L]

    return str(row.get("explanation", "") or "")


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

    # Drop sections that have zero rows up-front so we never render an
    # empty table (and never render a "no violations" placeholder either —
    # the absence of a table is the message).
    sections = [
        s for s in (payload.get("sections") or [])
        if (s.get("rows") or [])
    ]
    if sections:
        elements.append(_violation_table(
            sections,
            L=L,
            locale=locale,
            styles=styles,
            frame_width=frame_width,
        ))

    elements.append(Spacer(1, 4 * mm))

    # Legal disclaimer block (Belehrung). Same text on every locale-bound
    # PDF — the driver confirms they have been informed of the listed
    # violations and instructed to comply with EU 561 / KrFArbZG going
    # forward. Matches the German Verstöße-Details layout this customer
    # uses for office printing.
    elements.append(Paragraph(
        _DISCLAIMER.get(locale, _DISCLAIMER["de"]),
        styles.get("disclaimer") or styles["body"],
    ))
    elements.append(Spacer(1, 4 * mm))

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
        "disclaimer": ParagraphStyle(
            "disclaimer",
            parent=base["BodyText"],
            fontName=_FONT_REGULAR,
            fontSize=8,
            leading=10.5,
            textColor=MUTED,
            spaceBefore=2,
            spaceAfter=2,
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
    """4-column violation table.

    Columns: Verstoß | Zeit | Was passierte | Schwere
    The "what happened" column carries a single plain-language sentence
    (e.g. "Drove 10h 30min instead of the 9h maximum — 1h 30min over."),
    replacing the previous "X / Y" measured/allowed pair which was
    confusing for non-time-based rules and rest-shortfalls.
    """
    head = [
        Paragraph(L["col_kind"], styles["tableHead"]),
        Paragraph(L["col_period"], styles["tableHead"]),
        Paragraph(L["col_what"], styles["tableHead"]),
        Paragraph(L["col_severity"], styles["tableHead"]),
    ]
    rows: list[list[Any]] = [head]
    section_band_indices: list[int] = []
    severity_cells: list[tuple[int, str, Any, Any]] = []

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
            "", "", "",
        ])
        for row in section.get("rows", []):
            start_t = str(row.get("start_time", ""))[:16].replace("T", " ")
            end_t = str(row.get("end_time", ""))[:16].replace("T", " ")
            sev = _severity_pill(row.get("severity"), locale)
            description = _describe_incident(row, locale)

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
                Paragraph(description, styles["tableBody"]),
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
        frame_width * 0.30,  # kind
        frame_width * 0.18,  # period
        frame_width * 0.40,  # what happened (the meat of the row)
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
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]

    # Section header rows: span all 4 columns
    for idx in section_band_indices:
        style.append(("SPAN", (0, idx), (-1, idx)))
        style.append(("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#f6f7f9")))
        style.append(("LINEABOVE", (0, idx), (-1, idx), 0.5, LINE))
        style.append(("TOPPADDING", (0, idx), (-1, idx), 5))
        style.append(("BOTTOMPADDING", (0, idx), (-1, idx), 5))

    # Severity cell tint (severity is now column index 3)
    for row_idx, _label, bg, _fg in severity_cells:
        style.append(("BACKGROUND", (3, row_idx), (3, row_idx), bg))
        style.append(("LEFTPADDING", (3, row_idx), (3, row_idx), 6))
        style.append(("RIGHTPADDING", (3, row_idx), (3, row_idx), 6))

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
    """Bottom-of-page block.

    Top row: full-width Bemerkung (driver remark) box.
    Bottom row: three side-by-side slots — Ort+Datum | Unterschrift Fahrer
    | Unterschrift Verantwortlicher. The driver's signature image goes in
    the middle slot; the right slot stays empty for in-house signing
    after print.
    """
    sig_image = _decode_signature_image(signature_png_b64)
    sig_cell: Any = sig_image if sig_image is not None else Paragraph("—", styles["body"])

    # Row 1: remark / Bemerkung — full width.
    remark_table = Table(
        [
            [Paragraph(L["remark"].upper(), styles["metaLabel"])],
            [Paragraph(driver_remark or "—", styles["body"])],
        ],
        colWidths=[frame_width],
    )
    remark_table.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]),
    )

    # Row 2: three signature slots.
    sig_col_w = (frame_width - 12) / 3.0

    place_cell = Table(
        [
            [Paragraph(L.get("sig_place_date", "Ort, Datum").upper(), styles["metaLabel"])],
            [Paragraph(" ", styles["body"])],
            [Paragraph(
                signed_at.astimezone().strftime("%Y-%m-%d"),
                styles["body"],
            )],
        ],
        colWidths=[sig_col_w],
    )
    place_cell.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, LINE),
            ("LINEBELOW", (0, 1), (0, 1), 0.3, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]),
    )

    driver_cell = Table(
        [
            [Paragraph(L.get("sig_driver", "Unterschrift Fahrer").upper(),
                       styles["metaLabel"])],
            [sig_cell],
            [Paragraph(
                f"<b>{signer_name}</b><br/>"
                f"<font color='#6b6b70'>"
                f"{signed_at.astimezone().strftime('%Y-%m-%d %H:%M %Z')}"
                f"</font>",
                styles["body"],
            )],
        ],
        colWidths=[sig_col_w],
    )
    driver_cell.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, LINE),
            ("LINEBELOW", (0, 1), (0, 1), 0.3, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]),
    )

    resp_cell = Table(
        [
            [Paragraph(L.get("sig_responsible", "Unterschrift Verantwortlicher").upper(),
                       styles["metaLabel"])],
            [Paragraph(" ", styles["body"])],
            [Paragraph(" ", styles["body"])],
        ],
        colWidths=[sig_col_w],
    )
    resp_cell.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, LINE),
            ("LINEBELOW", (0, 1), (0, 1), 0.3, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]),
    )

    sig_row = Table(
        [[place_cell, driver_cell, resp_cell]],
        colWidths=[sig_col_w, sig_col_w, sig_col_w],
    )
    sig_row.setStyle(
        TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]),
    )

    band = Table(
        [[remark_table], [Spacer(1, 4)], [sig_row]],
        colWidths=[frame_width],
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
