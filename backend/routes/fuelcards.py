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


@bp.route('/api/fuel-cards/bulk', methods=['POST'])
@permission_required('vehicles')
def api_fuel_cards_bulk_create():
    """Bulk-create many cards for a single provider.

    Built for onboarding a whole batch from one provider at once: each
    entry is just a card name/number — no vehicle/license plate. Driver
    assignment is optional and the cards are created unassigned by default
    (``driver_name`` left empty). Limit/expiry/status/notes are shared
    across the batch.

    Accepts ``cards`` as either a list of strings or a newline-separated
    blob. Duplicates (within the request or already in the DB) are skipped,
    not failed, so a partial batch still goes through. Returns the created
    cards plus a list of skipped entries with a reason.
    """
    data = request.get_json(silent=True) or {}

    provider = (data.get('provider') or '').strip()[:64]
    driver_name = (data.get('driver_name') or '').strip()[:128]
    notes = (data.get('notes') or '').strip()[:1024]

    status = (data.get('status') or 'active').strip()
    if status not in _STATUSES:
        return jsonify({'error': f'status must be one of {_STATUSES}'}), 400
    try:
        limit = float(data.get('monthly_limit_eur') or 0)
    except (TypeError, ValueError):
        return jsonify({'error': 'monthly_limit_eur must be a number'}), 400
    expiry = (data.get('expiry_date') or '').strip()
    if expiry:
        try:
            datetime.strptime(expiry, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'expiry_date must be YYYY-MM-DD'}), 400

    raw = data.get('cards')
    if isinstance(raw, str):
        entries = raw.splitlines()
    elif isinstance(raw, list):
        entries = [str(x) for x in raw]
    else:
        entries = []

    # Normalize, drop blanks, dedupe within the request (case-insensitive),
    # preserving the order the user pasted them in.
    seen: set[str] = set()
    card_numbers: list[str] = []
    skipped: list[dict] = []
    for entry in entries:
        number = entry.strip()
        if not number:
            continue
        key = number.lower()
        if key in seen:
            skipped.append({'card_number': number, 'reason': 'duplicate'})
            continue
        seen.add(key)
        card_numbers.append(number)

    if not card_numbers:
        return jsonify({'error': 'no card numbers provided'}), 400

    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    created: list[dict] = []
    for number in card_numbers:
        try:
            cur = conn.execute(
                '''INSERT INTO fuel_cards
                   (card_number, provider, vehicle_name, driver_name,
                    monthly_limit_eur, expiry_date, status, notes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (number, provider, '', driver_name, limit, expiry, status, notes, now, now),
            )
            row = conn.execute('SELECT * FROM fuel_cards WHERE id = ?', (cur.lastrowid,)).fetchone()
            created.append(_row_to_dict(row))
        except Exception as exc:
            if 'UNIQUE' in str(exc).upper():
                skipped.append({'card_number': number, 'reason': 'duplicate'})
            else:
                skipped.append({'card_number': number, 'reason': str(exc)})
    conn.commit()
    conn.close()
    _log_activity(
        'fuel_card_bulk_create',
        f"{provider or '—'}: +{len(created)} ({len(skipped)} skipped)",
    )
    return jsonify({'created': created, 'skipped': skipped, 'count': len(created)})


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
