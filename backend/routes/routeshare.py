"""Public route-share links: follow a vehicle's route on a map (no login).

Admin/dispatcher endpoints (login + ``vehicles`` permission) create and manage
share links; the public endpoint (NO auth) serves the route for a valid token,
reusing the same Samsara trail logic as the internal fleet map so a shared link
shows exactly the same route, history and reverse-geocoded addresses.
"""

from datetime import datetime, timezone, timedelta

from flask import Blueprint, jsonify, request

from auth.decorators import permission_required
from auth.helpers import _log_activity
from services import route_share_service as svc
from routes.vehicles import fetch_vehicle_trail, TrailError

bp = Blueprint('routeshare', __name__)


def _public_url(token: str) -> str:
    return f"{request.host_url.rstrip('/')}/r/{token}"


def _share_dict(s: dict) -> dict:
    """Admin-facing representation of a share (adds public URL + expiry flag)."""
    return {
        'id': s['id'],
        'token': s['token'],
        'vehicle_id': s['vehicle_id'],
        'vehicle_name': s['vehicle_name'],
        'driver_name': s['driver_name'],
        'label': s['label'],
        'hours': s['hours'],
        'day': s['day'],
        'enabled': s['enabled'],
        'created_at': s['created_at'],
        'expires_at': s['expires_at'],
        'last_access': s['last_access'],
        'access_count': s['access_count'],
        'url': _public_url(s['token']),
        'expired': svc.is_expired(s),
    }


# ---------------------------------------------------------------------------
# Admin / dispatcher (login + 'vehicles' permission)
# ---------------------------------------------------------------------------

@bp.route('/api/route-shares', methods=['GET'])
@permission_required('vehicles')
def api_route_shares_list():
    return jsonify({'shares': [_share_dict(s) for s in svc.list_shares()]})


@bp.route('/api/route-shares', methods=['POST'])
@permission_required('vehicles')
def api_route_shares_create():
    data = request.get_json(silent=True) or {}
    vehicle_id = (data.get('vehicle_id') or '').strip()
    if not vehicle_id:
        return jsonify({'error': 'vehicle_id is required'}), 400

    day = (data.get('day') or '').strip()
    if day:
        try:
            datetime.strptime(day, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'day must be YYYY-MM-DD'}), 400

    try:
        hours = int(data.get('hours') or 24)
    except (TypeError, ValueError):
        hours = 24

    expires_at = ''
    try:
        exp_days = int(data.get('expires_in_days') or 0)
    except (TypeError, ValueError):
        exp_days = 0
    if exp_days > 0:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=exp_days)).isoformat()

    share = svc.create_share(
        vehicle_id=vehicle_id,
        vehicle_name=(data.get('vehicle_name') or '').strip(),
        driver_name=(data.get('driver_name') or '').strip(),
        label=(data.get('label') or '').strip(),
        hours=hours,
        day=day,
        expires_at=expires_at,
    )
    _log_activity('route_share_create', f"{share['vehicle_name'] or vehicle_id} ({share['token']})")
    return jsonify(_share_dict(share))


@bp.route('/api/route-shares/<int:share_id>', methods=['PATCH'])
@permission_required('vehicles')
def api_route_shares_update(share_id):
    s = svc.get_by_id(share_id)
    if not s:
        return jsonify({'error': 'not found'}), 404
    data = request.get_json(silent=True) or {}
    if 'enabled' in data:
        svc.set_enabled(share_id, bool(data.get('enabled')))
    return jsonify(_share_dict(svc.get_by_id(share_id)))


@bp.route('/api/route-shares/<int:share_id>', methods=['DELETE'])
@permission_required('vehicles')
def api_route_shares_delete(share_id):
    svc.delete_share(share_id)
    _log_activity('route_share_delete', str(share_id))
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Public (NO login, token-bearer)
# ---------------------------------------------------------------------------

@bp.route('/api/route-share/<token>', methods=['GET'])
def api_route_share_public(token):
    s = svc.get_by_token(token)
    if not svc.is_live(s):
        return jsonify({'error': 'Link nieaktywny lub wygasł / Link inaktiv oder abgelaufen'}), 404
    svc.touch_access(token)
    try:
        trail = fetch_vehicle_trail(s['vehicle_id'], hours=s['hours'], date_str=s['day'])
    except TrailError:
        # Never leak upstream details to the public; render an empty route.
        trail = {'points': [], 'total_km': 0.0, 'hours': s['hours'], 'date': s['day']}
    return jsonify({
        'label': s['label'],
        'driver_name': s['driver_name'],
        'vehicle_name': s['vehicle_name'],
        'day': s['day'],
        'hours': s['hours'],
        'live': not s['day'],
        'points': trail['points'],
        'total_km': trail['total_km'],
        'updated_at': datetime.now(timezone.utc).isoformat(),
    })
