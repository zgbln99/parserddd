"""Public route-share links: follow a vehicle's route on a map (no login).

Admin/dispatcher endpoints (login + ``vehicles`` permission) create and manage
share links; the public endpoint (NO auth) serves the route for a valid token,
reusing the same Samsara trail logic as the internal fleet map so a shared link
shows exactly the same route, history and reverse-geocoded addresses.
"""

from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request

from auth.decorators import permission_required
from auth.helpers import _log_activity
from services import route_share_service as svc
from routes.vehicles import fetch_vehicle_trail, TrailError

bp = Blueprint('routeshare', __name__)

CET = ZoneInfo('Europe/Berlin')


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
        'vehicles': s['vehicles'],
        'vehicle_count': len(s['vehicles']),
        'label': s['label'],
        'hours': s['hours'],
        'day': s['day'],
        'from_time': s['from_time'],
        'to_time': s['to_time'],
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

    # Accept a list of vehicles, or fall back to a single vehicle_id.
    vehicles = []
    raw_vehicles = data.get('vehicles')
    if isinstance(raw_vehicles, list):
        for v in raw_vehicles:
            if isinstance(v, dict) and str(v.get('id', '')).strip():
                vehicles.append({
                    'id': str(v.get('id')).strip(),
                    'name': (v.get('name') or '').strip(),
                    'driver': (v.get('driver') or '').strip(),
                })
    if not vehicles:
        vid = (data.get('vehicle_id') or '').strip()
        if vid:
            vehicles = [{
                'id': vid,
                'name': (data.get('vehicle_name') or '').strip(),
                'driver': (data.get('driver_name') or '').strip(),
            }]
    if not vehicles:
        return jsonify({'error': 'at least one vehicle is required'}), 400

    day = (data.get('day') or '').strip()
    if day:
        try:
            datetime.strptime(day, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'day must be YYYY-MM-DD'}), 400

    def _norm_hm(value):
        value = (value or '').strip()
        if not value:
            return ''
        try:
            hh, mm = value.split(':')
            hh, mm = int(hh), int(mm)
            if 0 <= hh <= 24 and 0 <= mm <= 59:
                return f'{hh:02d}:{mm:02d}'
        except (ValueError, IndexError):
            pass
        return ''

    from_time = _norm_hm(data.get('from_time')) if day else ''
    to_time = _norm_hm(data.get('to_time')) if day else ''

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
        vehicles=vehicles,
        label=(data.get('label') or '').strip(),
        hours=hours,
        day=day,
        from_time=from_time,
        to_time=to_time,
        expires_at=expires_at,
    )
    _log_activity('route_share_create', f"{len(vehicles)} veh ({share['token']})")
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

    # The route is shown one day at a time (default: today). A live/range share
    # lets the viewer browse the last N days; a fixed-day share shows that day.
    today = datetime.now(CET).date()
    if s['day']:
        selected = s['day']
        min_day = max_day = s['day']
        pickable = False
        fetch_day, from_time, to_time = s['day'], s['from_time'], s['to_time']
    else:
        days_back = max(1, min(31, (int(s['hours']) + 23) // 24))
        min_d = today - timedelta(days=days_back - 1)
        selected_d = today
        req = (request.args.get('day') or '').strip()
        if req:
            try:
                rd = datetime.strptime(req, '%Y-%m-%d').date()
                if min_d <= rd <= today:
                    selected_d = rd
            except ValueError:
                pass
        selected = selected_d.isoformat()
        min_day, max_day = min_d.isoformat(), today.isoformat()
        pickable = True
        fetch_day, from_time, to_time = selected, '', ''

    routes = []
    total_km = 0.0
    for v in s['vehicles']:
        try:
            trail = fetch_vehicle_trail(
                v['id'], date_str=fetch_day, from_time=from_time, to_time=to_time,
            )
        except TrailError:
            # Never leak upstream details to the public; render an empty route.
            trail = {'points': [], 'total_km': 0.0}
        routes.append({
            'vehicle_id': v['id'],
            'vehicle_name': v.get('name') or '',
            'driver_name': v.get('driver') or '',
            'points': trail['points'],
            'total_km': trail['total_km'],
        })
        total_km += trail.get('total_km') or 0.0

    is_today = selected == today.isoformat()
    return jsonify({
        'label': s['label'],
        'selected_day': selected,
        'min_day': min_day,
        'max_day': max_day,
        'pickable': pickable,
        'is_today': is_today,
        'live': is_today,
        'from_time': from_time,
        'to_time': to_time,
        'routes': routes,
        'total_km': round(total_km, 1),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    })
