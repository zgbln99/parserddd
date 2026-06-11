"""Fuel cards module — CRUD for fleet fuel cards (DKV/UTA/Shell/...).

Tracks: card number, provider, monthly limit, assigned vehicle/driver,
expiry date and status. Status lifecycle matters during a fleet-wide card
swap: ``ordered`` (zamówiona) → ``active`` → ``blocked``.

Permission: ``vehicles`` (fleet management), same as the vehicle pages.
"""

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from auth.decorators import permission_required
from auth.helpers import _get_db, _log_activity

bp = Blueprint('fuelcards', __name__)

_STATUSES = ('active', 'ordered', 'blocked')


def _row_to_dict(r) -> dict:
    return {
        'id': r['id'],
        'card_number': r['card_number'],
        'provider': r['provider'],
        'vehicle_name': r['vehicle_name'],
        'driver_name': r['driver_name'],
        'monthly_limit_eur': r['monthly_limit_eur'],
        'expiry_date': r['expiry_date'],
        'status': r['status'],
        'notes': r['notes'],
        'created_at': r['created_at'],
        'updated_at': r['updated_at'],
    }


def _read_payload(data: dict) -> tuple[dict, str | None]:
    """Validate + normalize a create/update payload. Returns (fields, error)."""
    card_number = (data.get('card_number') or '').strip()
    if not card_number:
        return {}, 'card_number is required'
    status = (data.get('status') or 'active').strip()
    if status not in _STATUSES:
        return {}, f'status must be one of {_STATUSES}'
    try:
        limit = float(data.get('monthly_limit_eur') or 0)
    except (TypeError, ValueError):
        return {}, 'monthly_limit_eur must be a number'
    expiry = (data.get('expiry_date') or '').strip()
    if expiry:
        try:
            datetime.strptime(expiry, '%Y-%m-%d')
        except ValueError:
            return {}, 'expiry_date must be YYYY-MM-DD'
    return {
        'card_number': card_number,
        'provider': (data.get('provider') or '').strip()[:64],
        'vehicle_name': (data.get('vehicle_name') or '').strip()[:64],
        'driver_name': (data.get('driver_name') or '').strip()[:128],
        'monthly_limit_eur': limit,
        'expiry_date': expiry,
        'status': status,
        'notes': (data.get('notes') or '').strip()[:1024],
    }, None


@bp.route('/api/fuel-cards', methods=['GET'])
@permission_required('vehicles')
def api_fuel_cards_list():
    conn = _get_db()
    rows = conn.execute(
        'SELECT * FROM fuel_cards ORDER BY vehicle_name, card_number'
    ).fetchall()
    conn.close()
    return jsonify({'cards': [_row_to_dict(r) for r in rows]})


@bp.route('/api/fuel-cards', methods=['POST'])
@permission_required('vehicles')
def api_fuel_cards_create():
    fields, err = _read_payload(request.get_json(silent=True) or {})
    if err:
        return jsonify({'error': err}), 400
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    try:
        cur = conn.execute(
            '''INSERT INTO fuel_cards
               (card_number, provider, vehicle_name, driver_name,
                monthly_limit_eur, expiry_date, status, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (fields['card_number'], fields['provider'], fields['vehicle_name'],
             fields['driver_name'], fields['monthly_limit_eur'], fields['expiry_date'],
             fields['status'], fields['notes'], now, now),
        )
        conn.commit()
        new_id = cur.lastrowid
    except Exception as exc:
        conn.close()
        if 'UNIQUE' in str(exc).upper():
            return jsonify({'error': 'card_number already exists'}), 409
        return jsonify({'error': str(exc)}), 500
    row = conn.execute('SELECT * FROM fuel_cards WHERE id = ?', (new_id,)).fetchone()
    conn.close()
    _log_activity('fuel_card_create', f"{fields['card_number']} → {fields['vehicle_name']}")
    return jsonify(_row_to_dict(row))


@bp.route('/api/fuel-cards/<int:card_id>', methods=['PUT'])
@permission_required('vehicles')
def api_fuel_cards_update(card_id: int):
    fields, err = _read_payload(request.get_json(silent=True) or {})
    if err:
        return jsonify({'error': err}), 400
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    existing = conn.execute('SELECT id FROM fuel_cards WHERE id = ?', (card_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({'error': 'not found'}), 404
    try:
        conn.execute(
            '''UPDATE fuel_cards SET
               card_number = ?, provider = ?, vehicle_name = ?, driver_name = ?,
               monthly_limit_eur = ?, expiry_date = ?, status = ?, notes = ?, updated_at = ?
               WHERE id = ?''',
            (fields['card_number'], fields['provider'], fields['vehicle_name'],
             fields['driver_name'], fields['monthly_limit_eur'], fields['expiry_date'],
             fields['status'], fields['notes'], now, card_id),
        )
        conn.commit()
    except Exception as exc:
        conn.close()
        if 'UNIQUE' in str(exc).upper():
            return jsonify({'error': 'card_number already exists'}), 409
        return jsonify({'error': str(exc)}), 500
    row = conn.execute('SELECT * FROM fuel_cards WHERE id = ?', (card_id,)).fetchone()
    conn.close()
    _log_activity('fuel_card_update', fields['card_number'])
    return jsonify(_row_to_dict(row))


@bp.route('/api/fuel-cards/<int:card_id>', methods=['DELETE'])
@permission_required('vehicles')
def api_fuel_cards_delete(card_id: int):
    conn = _get_db()
    row = conn.execute('SELECT card_number FROM fuel_cards WHERE id = ?', (card_id,)).fetchone()
    conn.execute('DELETE FROM fuel_cards WHERE id = ?', (card_id,))
    conn.commit()
    conn.close()
    _log_activity('fuel_card_delete', row['card_number'] if row else str(card_id))
    return jsonify({'ok': True})
