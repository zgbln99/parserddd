"""
Clean already-generated Stundenzettel XLSX files — the spreadsheet counterpart
of ``stz_pdf_clean``.

Done as **surgical edits on the original .xlsx zip** (not an openpyxl
round-trip): only the bytes that must change are touched, everything else is
copied through unchanged, so Excel keeps accepting the file (no "may be
damaged" repair prompt).

Edits (footer is in row 46, title in B1 — fixed by the DATEV template):
  - B1 title  -> empty
  - D46, I46 ("Unterschrift des ...") -> empty
  - H46 -> "Kontrolle durch" (inline string)
  - merges  D46:F46 -> C46:F46  and  I46:J46 -> H46:J46  (so "Datum" / "Kontrolle
    durch" centre under their whole signature line)
  - drop the DATEV logo (drawing element + drawing/media parts + rels + type)
  - fit to a single printed page (add pageSetUpPr fitToPage, drop scale)

Idempotent: re-running finds nothing left to change.
"""

import io
import re
import zipfile

_WS_RE = re.compile(r'^xl/worksheets/sheet\d+\.xml$')


def _cell_style(attrs: str) -> str:
    m = re.search(r'\bs="(\d+)"', attrs)
    return f' s="{m.group(1)}"' if m else ''


def _empty_cell(ref: str, xml: str) -> str:
    """Replace cell ``ref`` (self-closing or with a body) by an empty cell that
    keeps its style."""
    pat = re.compile(rf'<c r="{ref}"(?P<a>[^>]*?)(?:/>|>.*?</c>)', re.S)
    return pat.sub(lambda m: f'<c r="{ref}"{_cell_style(m.group("a"))}/>', xml, count=1)


def _edit_sheet(xml: str) -> str:
    # Footer + title text.
    xml = _empty_cell('B1', xml)
    xml = _empty_cell('D46', xml)
    xml = _empty_cell('I46', xml)
    xml = re.compile(r'<c r="H46"(?P<a>[^>]*?)(?:/>|>.*?</c>)', re.S).sub(
        lambda m: f'<c r="H46"{_cell_style(m.group("a"))} t="inlineStr"><is><t>Kontrolle durch</t></is></c>',
        xml, count=1)

    # Widen the merges so each label centres under the whole signature line.
    xml = xml.replace('<mergeCell ref="D46:F46"/>', '<mergeCell ref="C46:F46"/>')
    xml = xml.replace('<mergeCell ref="I46:J46"/>', '<mergeCell ref="H46:J46"/>')

    # Drop the logo drawing reference.
    xml = re.sub(r'<drawing\b[^>]*/>', '', xml)

    # Fit to one page: honour fitToWidth/Height (drop the fixed scale, enable
    # fitToPage). The DATEV sheet has fitToWidth/Height=1 already but no
    # pageSetUpPr, so it currently prints at scale.
    xml = re.sub(r'\s+scale="\d+"', '', xml)
    if '<pageSetUpPr' not in xml:
        if '<sheetPr' in xml:
            xml = re.sub(r'(<sheetPr[^>]*)/>', r'\1><pageSetUpPr fitToPage="1"/></sheetPr>', xml, count=1)
            xml = re.sub(r'(<sheetPr[^>]*>)(?!<pageSetUpPr)', r'\1<pageSetUpPr fitToPage="1"/>', xml, count=1)
        else:
            xml = re.sub(r'(<worksheet\b[^>]*>)', r'\1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>', xml, count=1)
    return xml


def clean_xlsx(data: bytes) -> bytes:
    zin = zipfile.ZipFile(io.BytesIO(data))
    names = zin.namelist()
    ws_name = next((n for n in names if _WS_RE.match(n)), None)
    ws_rels = None
    if ws_name:
        ws_rels = f'xl/worksheets/_rels/{ws_name.rsplit("/", 1)[-1]}.rels'

    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
        for n in names:
            if n.endswith('/'):
                continue  # directory marker — not a real part
            # Drop the DATEV logo parts entirely.
            if n.startswith('xl/drawings/') or n.startswith('xl/media/'):
                continue
            raw = zin.read(n)
            if n == ws_name:
                raw = _edit_sheet(raw.decode('utf-8')).encode('utf-8')
            elif n == ws_rels:
                txt = re.sub(r'<Relationship\b[^>]*Type="[^"]*/drawing"[^>]*/>', '', raw.decode('utf-8'))
                if '<Relationship ' not in txt:
                    continue  # nothing left to relate → drop the file
                raw = txt.encode('utf-8')
            elif n == '[Content_Types].xml':
                raw = re.sub(r'<Override PartName="/xl/drawings/[^"]*"[^>]*/>', '',
                             raw.decode('utf-8')).encode('utf-8')
            # ExcelJS corrupts the template's number-format code to the literal
            # string "[object Object]", which Excel rejects (it removes the DXF
            # and "repairs" the conditional formatting → the "may be damaged"
            # prompt). Restore a valid format code.
            if b'[object Object]' in raw:
                raw = raw.replace(b'formatCode="[object Object]"',
                                  b'formatCode="ddd\\,\\ dd;;"')
            zout.writestr(n, raw)
    return out.getvalue()
