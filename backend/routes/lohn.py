"""
Lohn Blueprint — parse DATEV LohnViewer exports.

Currently: ``POST /api/lohn/parse-ans`` reads a LohnViewer ``.ans`` (ANSI text)
export and returns, per employee and month, the 25% Nachtzuschlag hours so the
Stundenzettel generator can auto-fill them.
"""

from flask import Blueprint, request, jsonify

from auth.decorators import login_required
from services.lohn_ans import parse_ans

bp = Blueprint('lohn', __name__)


@bp.route('/api/lohn/parse-ans', methods=['POST'])
@login_required
def api_parse_lohn_ans():
    if 'file' not in request.files:
        return jsonify({'error': 'no file'}), 400
    file = request.files['file']
    data = file.read()
    if not data:
        return jsonify({'error': 'empty file'}), 400
    try:
        result = parse_ans(data)
    except Exception as exc:  # noqa: BLE001 — surface any parse failure as JSON
        return jsonify({'error': f'parse failed: {exc}'}), 400
    return jsonify(result)
