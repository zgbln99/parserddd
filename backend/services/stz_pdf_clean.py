"""
Clean already-generated Stundenzettel PDFs and fit them onto one page.

Removes the DATEV template chrome that shouldn't be on the finished document:
  - the "Vorlage zur Dokumentation der täglichen Arbeitszeit" title,
  - the DATEV logo (top-right image),
  - the "Unterschrift des Arbeitnehmers" / "Unterschrift des Arbeitgebers" labels.

The footer keeps a centred "Datum" under the left line and a centred
"Kontrolle durch" under the right line. Everything else (times, table, legend)
is preserved. Finally the (usually 2-3 page) document is composed onto a single
A4 page: the content is pulled up, slightly shrunk and centred, and any legend
rows that had overflowed onto later pages are appended right after the main
content.

Idempotent enough to be safe to re-run: on an already one-page, already-clean
PDF nothing matches and the original bytes are returned unchanged.
"""

import os

import fitz  # PyMuPDF

_TITLE = "Vorlage zur Dokumentation der täglichen Arbeitszeit"
_SIGN = ("Unterschrift des Arbeitnehmers", "Unterschrift des Arbeitgebers")
_FONT_PATHS = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
)

# One-page composition tuning (points).
_MARGIN_V = 22.0   # top/bottom margin
_MARGIN_H = 16.0   # left/right margin
_MAX_SCALE = 0.97  # always shrink at least a touch, for clean margins
_GAP = 7.0         # gap between stacked content blocks (overflow legend rows)


def _font_file():
    for p in _FONT_PATHS:
        if os.path.exists(p):
            return p
    return None


def _footer_lines(pg):
    """The two horizontal signature lines in the footer (left, right), each as
    ``(x0, x1, y)``, sorted left→right."""
    lines = []
    for d in pg.get_drawings():
        for it in d["items"]:
            if it[0] == "l":
                p1, p2 = it[1], it[2]
                if abs(p1.y - p2.y) < 1 and 715 < p1.y < 735 and abs(p2.x - p1.x) > 100:
                    lines.append((min(p1.x, p2.x), max(p1.x, p2.x), p1.y))
    lines.sort()
    return lines


def _clean_page(pg, font, fontfile):
    """Strip chrome + centre the Datum / Kontrolle durch footer. Returns True if
    anything on the page changed."""
    datums = [
        s for b in pg.get_text("dict")["blocks"]
        for ln in b.get("lines", []) for s in ln.get("spans", [])
        if s["text"].strip() == "Datum"
    ]
    lines = _footer_lines(pg)

    changed = False
    for r in pg.search_for(_TITLE):
        pg.add_redact_annot(r, fill=(1, 1, 1)); changed = True
    for img in pg.get_images(full=True):
        for r in pg.get_image_rects(img[0]):
            pg.add_redact_annot(r, fill=(1, 1, 1)); changed = True
    for needle in _SIGN:
        for r in pg.search_for(needle):
            pg.add_redact_annot(r, fill=(1, 1, 1)); changed = True

    footer = None
    if len(datums) >= 2 and len(lines) >= 2:
        size = min(d["size"] for d in datums)
        baseline = max(d["origin"][1] for d in datums)
        for d in datums:
            pg.add_redact_annot(fitz.Rect(d["bbox"]), fill=(1, 1, 1)); changed = True
        footer = (size, baseline, lines[0], lines[-1])

    if changed:
        pg.apply_redactions()
    if footer is not None:
        size, baseline, left, right = footer
        for (x0, x1, _y), label in ((left, "Datum"), (right, "Kontrolle durch")):
            cx = (x0 + x1) / 2.0
            tx = cx - font.text_length(label, size) / 2.0
            pg.insert_text((tx, baseline), label, fontsize=size,
                           fontfile=fontfile, fontname="DVS", color=(0, 0, 0))
    return changed


def _text_bbox(pg):
    """Union of the page's text spans (ignores stray vector artefacts)."""
    bb = fitz.Rect()
    for b in pg.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            for s in ln.get("spans", []):
                bb |= fitz.Rect(s["bbox"])
    return bb


def _compose_one_page(src):
    """Stack every page that has text onto a single A4 page: the main content
    first, then any overflow rows, pulled up, shrunk and centred."""
    clips = []  # (page_index, source_clip_rect)
    for i in range(len(src)):
        bb = _text_bbox(src[i])
        if bb.is_empty:
            continue
        clips.append((i, fitz.Rect(0, bb.y0 - 3, src[i].rect.width, bb.y1 + 3)))
    if len(clips) <= 1:
        return None  # already effectively one page

    total_h = sum(c[1].height for c in clips) + _GAP * (len(clips) - 1)
    page_w, page_h = src[0].rect.width, src[0].rect.height
    scale = min(_MAX_SCALE,
                (page_h - 2 * _MARGIN_V) / total_h,
                (page_w - 2 * _MARGIN_H) / page_w)
    left_base = (page_w - page_w * scale) / 2.0
    cursor = (page_h - total_h * scale) / 2.0

    out = fitz.open()
    newp = out.new_page(width=page_w, height=page_h)
    for idx, clip in clips:
        tr = fitz.Rect(left_base + clip.x0 * scale, cursor,
                       left_base + clip.x1 * scale, cursor + clip.height * scale)
        newp.show_pdf_page(tr, src, idx, clip=clip)
        cursor += clip.height * scale + _GAP * scale
    return out


def clean_pdf(data: bytes) -> bytes:
    """Return the cleaned, single-page PDF bytes (or the original ``data`` object
    if nothing needed changing)."""
    doc = fitz.open(stream=data, filetype="pdf")
    fontfile = _font_file()
    font = fitz.Font(fontfile=fontfile) if fontfile else fitz.Font("helv")
    try:
        changed = False
        for pg in doc:
            if _clean_page(pg, font, fontfile):
                changed = True

        composed = _compose_one_page(doc)
        if composed is not None:
            try:
                result = composed.tobytes(deflate=True, garbage=4)
            finally:
                composed.close()
            return result
        if not changed:
            return data
        return doc.tobytes(deflate=True, garbage=4)
    finally:
        doc.close()
