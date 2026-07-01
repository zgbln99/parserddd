"""
Stundenzettel Blueprint — OCR parsing of timesheets and vacation PDFs.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
from collections import defaultdict

from flask import Blueprint, request, jsonify, Response

from auth.decorators import login_required
from auth.helpers import _log_activity
from config import logger, STUNDENZETTEL_FOLDER
from services.dropbox_service import get_server_dropbox_client
from services.openai_service import _parse_stundenzettel_with_openai, _calculate_stundenzettel

bp = Blueprint('stundenzettel', __name__)


def _soffice_bin():
    """Locate the LibreOffice binary (soffice / libreoffice), or None."""
    for name in ('soffice', 'libreoffice'):
        path = shutil.which(name)
        if path:
            return path
    return None


def _xlsx_to_pdf(data: bytes) -> bytes:
    """Convert .xlsx bytes to PDF via headless LibreOffice (1:1 with the sheet).

    Raises RuntimeError on failure and subprocess.TimeoutExpired on timeout.
    """
    soffice = _soffice_bin()
    if not soffice:
        raise RuntimeError('LibreOffice ist auf dem Server nicht installiert')
    with tempfile.TemporaryDirectory() as workdir:
        xlsx_path = os.path.join(workdir, 'input.xlsx')
        with open(xlsx_path, 'wb') as fh:
            fh.write(data)
        # LibreOffice needs a writable HOME and an isolated user profile so that
        # concurrent conversions don't clash.
        env = os.environ.copy()
        env['HOME'] = workdir
        profile = 'file://' + os.path.join(workdir, 'lo-profile')
        proc = subprocess.run(
            [soffice, '--headless', '--nologo', '--nofirststartwizard', '--norestore',
             '-env:UserInstallation=' + profile,
             '--convert-to', 'pdf', '--outdir', workdir, xlsx_path],
            env=env, capture_output=True, timeout=120,
        )
        pdf_path = os.path.join(workdir, 'input.pdf')
        if proc.returncode != 0 or not os.path.exists(pdf_path):
            logger.error('soffice convert failed rc=%s stderr=%s',
                         proc.returncode, (proc.stderr or b'')[:500])
            raise RuntimeError('PDF-Konvertierung fehlgeschlagen')
        with open(pdf_path, 'rb') as fh:
            return fh.read()


def _safe_stz_name(period: str, name: str, fallback: str) -> str:
    """Build a storage-safe base filename, e.g. '2025-10 Arbeitszeit Marek Piatak'."""
    if re.match(r'^\d{4}-\d{2}$', period or ''):
        label = f"{period} Arbeitszeit {name}".strip()
    else:
        label = (name or '').strip()
    if not label:
        label = re.sub(r'\.xlsx?$', '', fallback or 'Arbeitszeit', flags=re.I)
    safe = ''.join(c for c in label if c.isalnum() or c in '._- ').strip()
    return safe or 'Arbeitszeit'


def _safe_folder(name: str) -> str:
    """One storage-safe path segment from an employee name (no slashes / traversal)."""
    safe = ''.join(c for c in (name or '') if c.isalnum() or c in ' ._-').strip()
    safe = safe.strip('. ')  # no leading/trailing dots or spaces
    return safe or 'Unbekannt'


@bp.route('/api/stundenzettel/pdf', methods=['POST'])
@login_required
def api_stundenzettel_pdf():
    """Convert an already-filled .xlsx (the DATEV Arbeitszeit template) to PDF
    via headless LibreOffice, so the PDF is 1:1 with the spreadsheet."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    data = file.read()
    if not data:
        return jsonify({'error': 'Empty file'}), 400
    if len(data) > 8 * 1024 * 1024:
        return jsonify({'error': 'File too large'}), 413

    download_name = os.path.basename(file.filename or 'Arbeitszeit.xlsx')
    download_name = re.sub(r'\.xlsx?$', '', download_name, flags=re.I) + '.pdf'

    try:
        pdf_bytes = _xlsx_to_pdf(data)
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'PDF-Konvertierung hat zu lange gedauert'}), 504
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 500

    resp = Response(pdf_bytes, mimetype='application/pdf')
    resp.headers['Content-Disposition'] = f'attachment; filename="{download_name}"'
    return resp


@bp.route('/api/stundenzettel/save-to-dropbox', methods=['POST'])
@login_required
def api_stundenzettel_save_to_dropbox():
    """Archive the filled Stundenzettel on the server storage (MEGA S4),
    like MAUT / driver cards: saves the .xlsx and (best-effort) the PDF."""
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400
    file = request.files['file']
    data = file.read()
    if not data:
        return jsonify({'error': 'Pusty plik'}), 400
    if len(data) > 8 * 1024 * 1024:
        return jsonify({'error': 'Plik za duży'}), 413

    period = (request.form.get('period') or '').strip()
    name = (request.form.get('name') or '').strip()
    # Per-employee folder with XLSX / PDF subfolders:
    #   /Stundenzettel/<Name>/XLSX/<file>.xlsx
    #   /Stundenzettel/<Name>/PDF/<file>.pdf
    folder = _safe_folder(name)
    base = _safe_stz_name(period, name, file.filename or '')
    root = f"{STUNDENZETTEL_FOLDER}/{folder}"

    dbx = get_server_dropbox_client()
    if not dbx:
        return jsonify({'error': 'Brak polaczenia z Dropbox'}), 500

    saved = []
    try:
        dbx.files_upload(data, f"{root}/XLSX/{base}.xlsx")
        saved.append(f"{folder}/XLSX/{base}.xlsx")
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500

    # PDF is best-effort — a failed conversion must not lose the .xlsx save.
    try:
        pdf_bytes = _xlsx_to_pdf(data)
        dbx.files_upload(pdf_bytes, f"{root}/PDF/{base}.pdf")
        saved.append(f"{folder}/PDF/{base}.pdf")
    except Exception as exc:
        logger.warning('Stundenzettel PDF save skipped: %s', exc)

    _log_activity('stundenzettel_save', folder)
    return jsonify({'ok': True, 'folder': root, 'saved': saved})


@bp.route('/api/stundenzettel/parse', methods=['POST'])
@login_required
def api_parse_stundenzettel():
    """Parse a Stundenzettel image or PDF using OpenAI GPT-4o Vision."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    filename = (file.filename or '').lower()
    file_data = file.read()

    if not file_data:
        return jsonify({'error': 'Empty file'}), 400

    try:
        if filename.endswith('.pdf'):
            try:
                import fitz  # PyMuPDF
            except ImportError:
                return jsonify({'error': 'PyMuPDF not installed (pip install pymupdf)'}), 500

            doc = fitz.open(stream=file_data, filetype='pdf')
            all_results = []
            for page_num in range(min(len(doc), 5)):
                page = doc[page_num]
                pix = page.get_pixmap(dpi=200)
                img_data = pix.tobytes('png')
                try:
                    parsed = _parse_stundenzettel_with_openai(img_data, 'image/png')
                    result = _calculate_stundenzettel(parsed)
                    all_results.append(result)
                except Exception as exc:
                    logger.warning('Stundenzettel page %d parse error: %s', page_num, exc)
                    all_results.append({'error': str(exc), 'page': page_num + 1})
            doc.close()
            return jsonify({'results': all_results, 'pages': len(all_results)})

        elif filename.endswith(('.jpg', '.jpeg')):
            media_type = 'image/jpeg'
        elif filename.endswith('.png'):
            media_type = 'image/png'
        elif filename.endswith('.webp'):
            media_type = 'image/webp'
        else:
            return jsonify({'error': 'Unsupported file type. Use JPG, PNG, WebP or PDF.'}), 400

        parsed = _parse_stundenzettel_with_openai(file_data, media_type)
        result = _calculate_stundenzettel(parsed)
        return jsonify({'results': [result], 'pages': 1})

    except Exception as exc:
        logger.error('Stundenzettel parse error: %s', exc)
        return jsonify({'error': str(exc)}), 500


@bp.route('/api/vacation/parse', methods=['POST'])
@login_required
def api_vacation_parse():
    """Parse an Urlaubsbericht PDF and return vacation entries."""
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nie wybrano pliku'}), 400
    try:
        import pdfplumber
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name

        entries = []
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if not row or len(row) < 4:
                            continue
                        name = (row[0] or '').strip()
                        if not name or name.lower() in ('mitarbeiter', ''):
                            continue
                        von = (row[1] or '').strip()
                        bis = (row[2] or '').strip()
                        tage_raw = (row[3] or '').strip()
                        tage_match = re.match(r'(\d+)', tage_raw)
                        tage = int(tage_match.group(1)) if tage_match else 0
                        if not von or not tage:
                            continue

                        def parse_de_date(s):
                            m = re.match(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', s)
                            if m:
                                return f'{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}'
                            return s

                        entries.append({
                            'name': name,
                            'von': parse_de_date(von),
                            'bis': parse_de_date(bis),
                            'tage': tage,
                            'raw_tage': tage_raw,
                        })

        by_name = defaultdict(lambda: {'ranges': [], 'total_tage': 0})
        for e in entries:
            by_name[e['name']]['ranges'].append({
                'von': e['von'],
                'bis': e['bis'],
                'tage': e['tage'],
            })
            by_name[e['name']]['total_tage'] += e['tage']

        result = []
        for name, data in by_name.items():
            result.append({
                'name': name,
                'ranges': data['ranges'],
                'total_tage': data['total_tage'],
            })

        return jsonify({'entries': result, 'count': len(result)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'tmp_path' in locals():
            os.unlink(tmp_path)
