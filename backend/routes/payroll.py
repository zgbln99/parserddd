"""
Payroll Blueprint — payroll status per driver per month.
"""

from datetime import datetime

from flask import Blueprint, request, jsonify

from auth.decorators import login_required
from auth.helpers import _get_db

bp = Blueprint('payroll', __name__)


@bp.route('/api/payroll-status/<period>')
@login_required
def api_get_payroll_status(period):
    """Get payroll status for all drivers in a given period (YYYY-MM)."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT card_number, status FROM payroll_status WHERE period = ?",
        (period,),
    ).fetchall()
    conn.close()
    statuses = {row[0]: row[1] for row in rows}
    return jsonify({'period': period, 'statuses': statuses})


@bp.route('/api/payroll-status/<period>', methods=['POST'])
@login_required
def api_set_payroll_status(period):
    """Set payroll status for a driver."""
    body = request.get_json(force=True)
    card_number = body.get('card_number', '').strip()
    status = body.get('status', '').strip()
    if not card_number:
        return jsonify({'error': 'card_number required'}), 400
    if status not in ('', 'policzony', 'stundenzettel'):
        return jsonify({'error': 'Invalid status'}), 400

    now = datetime.utcnow().isoformat()
    conn = _get_db()
    if status == '':
        conn.execute(
            "DELETE FROM payroll_status WHERE card_number = ? AND period = ?",
            (card_number, period),
        )
    else:
        conn.execute('''
            INSERT INTO payroll_status (card_number, period, status, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(card_number, period) DO UPDATE SET
                status = excluded.status,
                updated_at = excluded.updated_at
        ''', (card_number, period, status, now))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@bp.route('/api/payroll-status/<period>/clear', methods=['POST'])
@login_required
def api_clear_payroll_status(period):
    """Bulk-clear payroll statuses for a period in a single DB operation.

    Body ``{"status": "policzony"}`` clears only that status; no/empty status
    clears everything for the period. Returns how many rows were removed.
    """
    body = request.get_json(silent=True) or {}
    status = (body.get('status') or '').strip()
    conn = _get_db()
    if status:
        if status not in ('policzony', 'stundenzettel'):
            conn.close()
            return jsonify({'error': 'Invalid status'}), 400
        cur = conn.execute(
            "DELETE FROM payroll_status WHERE period = ? AND status = ?",
            (period, status),
        )
    else:
        cur = conn.execute(
            "DELETE FROM payroll_status WHERE period = ?",
            (period,),
        )
    cleared = cur.rowcount if cur.rowcount is not None else 0
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'cleared': cleared})
