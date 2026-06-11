"""Vehicle deadlines — TÜV/HU, insurance, ADR, tachograph calibration, etc.

Each row is one upcoming deadline for a vehicle. The UI sorts by due date
and the notification bell warns about deadlines due soon / overdue.

Permission: ``vehicles``.
"""

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from auth.decorators import permission_required
from auth.helpers import _get_db, _log_activity

bp = Blueprint('deadlines', __name__)


def _row(r) -> dict:
    return {
        'id': r['id'],
        'vehicle_name': r['vehicle_name'],
        'kind': r['kind'],
        'due_date': r['due_date'],
        'notes': r['notes'],
        'created_at': r['created_at'],
        'updated_at': r['updated_at'],
    }


def _payload(data: dict) -> tuple[dict, str | None]:
    vehicle = (data.get('vehicle_name') or '').strip()
    kind = (data.get('kind') or '').strip()
    due = (data.get('due_date') or '').strip()
    if not vehicle:
        return {}, 'vehicle_name is required'
    if not kind:
        return {}, 'kind is required'
    if due:
        try:
            datetime.strptime(due, '%Y-%m-%d')
        except ValueError:
            return {}, 'due_date must be YYYY-MM-DD'
    return {
        'vehicle_name': vehicle[:64],
        'kind': kind[:48],
        'due_date': due,
        'notes': (data.get('notes') or '').strip()[:512],
    }, None


@bp.route('/api/vehicle-deadlines', methods=['GET'])
@permission_required('vehicles')
def api_list():
    conn = _get_db()
    rows = conn.execute(
        "SELECT * FROM vehicle_deadlines ORDER BY due_date = '' , due_date, vehicle_name"
    ).fetchall()
    conn.close()
    return jsonify({'deadlines': [_row(r) for r in rows]})


@bp.route('/api/vehicle-deadlines', methods=['POST'])
@permission_required('vehicles')
def api_create():
    fields, err = _payload(request.get_json(silent=True) or {})
    if err:
        return jsonify({'error': err}), 400
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    cur = conn.execute(
        '''INSERT INTO vehicle_deadlines (vehicle_name, kind, due_date, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)''',
        (fields['vehicle_name'], fields['kind'], fields['due_date'], fields['notes'], now, now),
    )
    conn.commit()
    new_id = cur.lastrowid
    row = conn.execute('SELECT * FROM vehicle_deadlines WHERE id = ?', (new_id,)).fetchone()
    conn.close()
    _log_activity('deadline_create', f"{fields['vehicle_name']} — {fields['kind']}")
    return jsonify(_row(row))


@bp.route('/api/vehicle-deadlines/<int:did>', methods=['PUT'])
@permission_required('vehicles')
def api_update(did: int):
    fields, err = _payload(request.get_json(silent=True) or {})
    if err:
        return jsonify({'error': err}), 400
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    if not conn.execute('SELECT id FROM vehicle_deadlines WHERE id = ?', (did,)).fetchone():
        conn.close()
        return jsonify({'error': 'not found'}), 404
    conn.execute(
        '''UPDATE vehicle_deadlines SET vehicle_name = ?, kind = ?, due_date = ?, notes = ?, updated_at = ?
           WHERE id = ?''',
        (fields['vehicle_name'], fields['kind'], fields['due_date'], fields['notes'], now, did),
    )
    conn.commit()
    row = conn.execute('SELECT * FROM vehicle_deadlines WHERE id = ?', (did,)).fetchone()
    conn.close()
    _log_activity('deadline_update', f"{fields['vehicle_name']} — {fields['kind']}")
    return jsonify(_row(row))


@bp.route('/api/vehicle-deadlines/<int:did>', methods=['DELETE'])
@permission_required('vehicles')
def api_delete(did: int):
    conn = _get_db()
    conn.execute('DELETE FROM vehicle_deadlines WHERE id = ?', (did,))
    conn.commit()
    conn.close()
    _log_activity('deadline_delete', str(did))
    return jsonify({'ok': True})
