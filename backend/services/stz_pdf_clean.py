"""
Clean already-generated Stundenzettel PDFs.

Removes the DATEV template chrome that shouldn't be on the finished document:
  - the "Vorlage zur Dokumentation der täglichen Arbeitszeit" title,
  - the DATEV logo (top-right image),
  - the "Unterschrift des Arbeitnehmers" / "Unterschrift des Arbeitgebers" labels.

The left signature field keeps its "Datum" label; the right one is turned into a
"Kontrolle durch" field (its "Datum" is replaced). The signature lines and all
the actual timesheet data are left untouched.

Idempotent: running it again on an already-cleaned PDF is a no-op (the function
returns the original bytes object unchanged).
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


def _font_file():
    for p in _FONT_PATHS:
        if os.path.exists(p):
            return p
    return None


def clean_pdf(data: bytes) -> bytes:
    """Return cleaned PDF bytes, or the original ``data`` object if nothing
    needed changing (so callers can skip the re-upload)."""
    doc = fitz.open(stream=data, filetype="pdf")
    fontfile = _font_file()
    changed = False
    try:
        for pg in doc:
            datums = [
                s for b in pg.get_text("dict")["blocks"]
                for ln in b.get("lines", []) for s in ln.get("spans", [])
                if s["text"].strip() == "Datum"
            ]
            did = False
            for r in pg.search_for(_TITLE):
                pg.add_redact_annot(r, fill=(1, 1, 1)); did = True
            for img in pg.get_images(full=True):
                for r in pg.get_image_rects(img[0]):
                    pg.add_redact_annot(r, fill=(1, 1, 1)); did = True
            for needle in _SIGN:
                for r in pg.search_for(needle):
                    pg.add_redact_annot(r, fill=(1, 1, 1)); did = True

            kontrolle_pt = None
            font_size = 8.11
            # Only the footer page has two "Datum" labels — turn the right one
            # into "Kontrolle durch".
            if len(datums) >= 2:
                right = max(datums, key=lambda s: s["origin"][0])
                pg.add_redact_annot(fitz.Rect(right["bbox"]), fill=(1, 1, 1)); did = True
                kontrolle_pt = fitz.Point(right["origin"][0], right["origin"][1])
                font_size = right["size"]

            if did:
                pg.apply_redactions()
                changed = True
            if kontrolle_pt is not None:
                if fontfile:
                    pg.insert_text(kontrolle_pt, "Kontrolle durch", fontsize=font_size,
                                   fontfile=fontfile, fontname="DVS", color=(0, 0, 0))
                else:
                    pg.insert_text(kontrolle_pt, "Kontrolle durch", fontsize=font_size,
                                   fontname="helv", color=(0, 0, 0))

        if not changed:
            return data
        return doc.tobytes(deflate=True, garbage=4)
    finally:
        doc.close()
