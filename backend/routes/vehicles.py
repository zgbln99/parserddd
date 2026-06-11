from datetime import datetime, timezone
from calendar import monthrange
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request, current_app
import requests as http_requests

from auth.decorators import permission_required
from auth.helpers import _log_activity, _get_db
from config import (
    SAMSARA_API_TOKEN,
    SAMSARA_API_BASE,
    VEHICLE_ACTIVITY_CACHE,
    VEHICLE_ACTIVITY_CACHE_TTL,
)
from core.utils import _haversine_km

bp = Blueprint('vehicles', __name__)

CET = ZoneInfo('Europe/Berlin')


@bp.route('/api/vehicles', methods=['GET'])
@permission_required('vehicles')
def api_vehicles_list():
    """List vehicles from Samsara."""
    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Samsara API not configured'}), 400

    headers = {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}
    vehicles = []
    after = None

    for _ in range(20):  # max pages
        params = {'limit': 100}
        if after:
            params['after'] = after
        try:
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/vehicles',
                headers=headers, params=params, timeout=15,
            )
            if resp.status_code != 200:
                return jsonify({'error': f'Samsara API error: {resp.status_code}'}), 502
            data = resp.json()
        except Exception as e:
            return jsonify({'error': str(e)}), 502

        for v in data.get('data', []):
            vehicles.append({
                'id': v.get('id', ''),
                'name': v.get('name', ''),
                'vin': v.get('vin', ''),
                'serial': v.get('serial', ''),
                'license_plate': v.get('licensePlate', ''),
            })
        pag = data.get('pagination', {})
        if pag.get('hasNextPage') and pag.get('endCursor'):
            after = pag['endCursor']
        else:
            break

    _log_activity('vehicles_list', f'{len(vehicles)} vehicles')
    return jsonify({'vehicles': vehicles})


@bp.route('/api/vehicles/locations', methods=['GET'])
@permission_required('vehicles')
def api_vehicles_locations():
    """Live fleet snapshot: current GPS position + speed of every vehicle.

    Uses the Samsara stats snapshot (`types=gps`) which carries reverse-geo
    formatted addresses, so the dispatcher sees street/city text instead of
    raw coordinates.
    """
    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Samsara API not configured'}), 400

    headers = {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}
    rows = []
    after = None

    for _ in range(20):  # max pages
        params = {'types': 'gps', 'limit': 100}
        if after:
            params['after'] = after
        try:
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/vehicles/stats',
                headers=headers, params=params, timeout=15,
            )
            if resp.status_code != 200:
                return jsonify({'error': f'Samsara API error: {resp.status_code}'}), 502
            data = resp.json()
        except Exception as e:
            return jsonify({'error': str(e)}), 502

        for v in data.get('data', []):
            gps = v.get('gps')
            # snapshot returns an object; be tolerant if it arrives as a list
            if isinstance(gps, list):
                gps = gps[0] if gps else None
            if not isinstance(gps, dict):
                continue
            kmh = float(gps.get('speedMilesPerHour', 0) or 0) * 1.609344
            rows.append({
                'vehicle_id': v.get('id', ''),
                'vehicle_name': v.get('name', ''),
                'latitude': gps.get('latitude'),
                'longitude': gps.get('longitude'),
                'speed_kmh': round(kmh),
                'heading': gps.get('headingDegrees'),
                'location': (gps.get('reverseGeo') or {}).get('formattedLocation', ''),
                'updated_at': gps.get('time', ''),
            })
        pag = data.get('pagination', {})
        if pag.get('hasNextPage') and pag.get('endCursor'):
            after = pag['endCursor']
        else:
            break

    # Track how long each vehicle has been standing. We record the last
    # moment we saw it moving; while it stands, the gap to that moment is
    # the stop duration. First sighting of a stopped vehicle starts the
    # clock at "now" (we can't know how long it stood before).
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    try:
        conn = _get_db()
        for r in rows:
            if r['speed_kmh'] > 5:
                conn.execute(
                    '''INSERT INTO vehicle_movement (vehicle_id, vehicle_name, last_moving_at, updated_at)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(vehicle_id) DO UPDATE SET
                           vehicle_name = excluded.vehicle_name,
                           last_moving_at = excluded.last_moving_at,
                           updated_at = excluded.updated_at''',
                    (r['vehicle_id'], r['vehicle_name'], now_iso, now_iso),
                )
                r['stopped_minutes'] = 0
            else:
                row = conn.execute(
                    'SELECT last_moving_at FROM vehicle_movement WHERE vehicle_id = ?',
                    (r['vehicle_id'],),
                ).fetchone()
                if row and row['last_moving_at']:
                    try:
                        last = datetime.fromisoformat(row['last_moving_at'])
                        r['stopped_minutes'] = max(0, int((now - last).total_seconds() // 60))
                    except ValueError:
                        r['stopped_minutes'] = None
                else:
                    conn.execute(
                        '''INSERT INTO vehicle_movement (vehicle_id, vehicle_name, last_moving_at, updated_at)
                           VALUES (?, ?, ?, ?)
                           ON CONFLICT(vehicle_id) DO NOTHING''',
                        (r['vehicle_id'], r['vehicle_name'], now_iso, now_iso),
                    )
                    r['stopped_minutes'] = None
        conn.commit()
        conn.close()
    except Exception:
        for r in rows:
            r.setdefault('stopped_minutes', None)

    rows.sort(key=lambda r: r['vehicle_name'])
    return jsonify({'vehicles': rows})


@bp.route('/api/vehicles/activity', methods=['POST'])
@permission_required('vehicles')
def api_vehicles_activity():
    """
    Fetch vehicle activity from Samsara using trips/stream endpoint.
    Returns daily breakdown: date, start/end time, duration, distance.
    """
    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Samsara API not configured'}), 400

    body = request.get_json(force=True)
    period = body.get('period', '')  # "2026-03"
    date_from = body.get('date_from', '')  # "2026-03-01" (optional, overrides period)
    date_to = body.get('date_to', '')  # "2026-03-15" (optional, overrides period)
    vehicle_ids = body.get('vehicle_ids', [])  # required
    # skip_location removed — always fetch all sources for accuracy

    # Support date range (date_from + date_to) or legacy month period
    if date_from and date_to:
        if len(date_from) != 10 or len(date_to) != 10:
            return jsonify({'error': 'Invalid date_from/date_to (expected YYYY-MM-DD)'}), 400
        period = date_from[:7]  # for cache key / response label
    elif not period or len(period) != 7:
        return jsonify({'error': 'Invalid period (expected YYYY-MM)'}), 400

    if not vehicle_ids:
        return jsonify({'error': 'No vehicle selected'}), 400

    # --- Check cache ---
    cache_key = (date_from or period, date_to or period, tuple(sorted(vehicle_ids)))
    cached = VEHICLE_ACTIVITY_CACHE.get(cache_key)
    if cached:
        cache_ts, cache_data = cached
        if (datetime.now() - cache_ts).total_seconds() < VEHICLE_ACTIVITY_CACHE_TTL:
            current_app.logger.info('Vehicle activity cache hit for %s', cache_key)
            return jsonify(cache_data)

    if date_from and date_to:
        start_time = f'{date_from}T00:00:00Z'
        end_time = f'{date_to}T23:59:59Z'
    else:
        year, month = int(period[:4]), int(period[5:7])
        _, last_day = monthrange(year, month)
        start_time = f'{period}-01T00:00:00Z'
        end_time = f'{period}-{last_day:02d}T23:59:59Z'

    headers = {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}
    ids_param = ','.join(vehicle_ids[:50])

    debug_info = {'api_calls': 0, 'raw_trips': 0, 'errors': []}

    # ---- Helper functions for parallel fetching ----

    def _fetch_trips():
        """Fetch trips from trips/stream endpoint."""
        trips = []
        info = {'api_calls': 0, 'raw_trips': 0, 'errors': []}
        after_cursor = None
        for _ in range(200):
            params = {
                'ids': ids_param,
                'startTime': start_time,
                'endTime': end_time,
                'queryBy': 'tripStartTime',
                'completionStatus': 'completed',
                'includeAsset': 'true',
            }
            if after_cursor:
                params['after'] = after_cursor
            info['api_calls'] += 1
            try:
                resp = http_requests.get(
                    f'{SAMSARA_API_BASE}/trips/stream',
                    headers=headers, params=params, timeout=30,
                )
                if resp.status_code != 200:
                    info['errors'].append(f'HTTP {resp.status_code}: {resp.text[:500] if resp.text else ""}')
                    break
                data = resp.json()
            except Exception as exc:
                info['errors'].append(str(exc))
                break
            batch = data.get('data', [])
            info['raw_trips'] += len(batch)
            trips.extend(batch)
            pag = data.get('pagination', {})
            if pag.get('hasNextPage') and pag.get('endCursor'):
                after_cursor = pag['endCursor']
            else:
                break
        return trips, info

    def _fetch_stats():
        """Fetch OBD odometer / GPS distance stats."""
        all_stats = {vid: [] for vid in vehicle_ids}
        info = {'api_calls': 0, 'errors': []}
        stats_after = None
        for _ in range(50):
            stat_params = {
                'vehicleIds': ids_param,
                'types': 'obdOdometerMeters,gpsDistanceMeters',
                'startTime': start_time,
                'endTime': end_time,
            }
            if stats_after:
                stat_params['after'] = stats_after
            info['api_calls'] += 1
            sresp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/vehicles/stats/history',
                headers=headers, params=stat_params, timeout=30,
            )
            if sresp.status_code != 200:
                info['errors'].append(f'stats/history HTTP {sresp.status_code}: {sresp.text[:300]}')
                break
            sdata = sresp.json()
            for entry in sdata.get('data', []):
                vid = entry.get('id', '')
                if vid not in all_stats:
                    all_stats[vid] = []
                for stat_type in ['obdOdometerMeters', 'gpsDistanceMeters']:
                    for point in entry.get(stat_type, []):
                        val = point.get('value', 0) or 0
                        ts = point.get('time', '')
                        if val and ts:
                            all_stats[vid].append({
                                'type': stat_type,
                                'value': float(val),
                                'time': ts,
                            })
            spag = sdata.get('pagination', {})
            if spag.get('hasNextPage') and spag.get('endCursor'):
                stats_after = spag['endCursor']
            else:
                break

        # Calculate daily km from stats
        stats_daily = {}
        for vid, points in all_stats.items():
            if not points:
                continue
            obd_pts = [p for p in points if p['type'] == 'obdOdometerMeters']
            gps_pts = [p for p in points if p['type'] == 'gpsDistanceMeters']
            use_pts = obd_pts if obd_pts else gps_pts
            if not use_pts:
                continue
            day_readings = {}
            for p in use_pts:
                try:
                    dt = datetime.fromisoformat(p['time'].replace('Z', '+00:00')).astimezone(CET)
                    dk = dt.strftime('%Y-%m-%d')
                    day_readings.setdefault(dk, []).append(p['value'])
                except Exception:
                    continue
            if vid not in stats_daily:
                stats_daily[vid] = {}
            sorted_days = sorted(day_readings.keys())
            prev_day_max = None
            for dk in sorted_days:
                readings = day_readings[dk]
                curr_max = max(readings)
                if prev_day_max is not None:
                    # Distance = today's max odometer - yesterday's max odometer
                    # This captures ALL driving between days (no gaps lost)
                    diff = curr_max - prev_day_max
                    if diff > 0:
                        stats_daily[vid][dk] = round(diff / 1000, 1)
                elif len(readings) >= 2:
                    # First day: best we can do is max-min within the day
                    stats_daily[vid][dk] = round((curr_max - min(readings)) / 1000, 1)
                prev_day_max = curr_max

        has_obd = any(p['type'] == 'obdOdometerMeters' for pts in all_stats.values() for p in pts)
        has_gps = any(p['type'] == 'gpsDistanceMeters' for pts in all_stats.values() for p in pts)
        info['stats_vehicles'] = len([v for v in all_stats.values() if v])
        info['stats_daily_entries'] = sum(len(d) for d in stats_daily.values())
        info['stats_source'] = 'obdOdometer' if has_obd else 'gpsDistance' if has_gps else 'none'
        return stats_daily, info

    def _fetch_gps():
        """Fetch GPS breadcrumbs for location + distance calculation."""
        daily_location = {}
        daily_points = {}
        daily_km = {}
        info = {'api_calls': 0, 'errors': [], 'gps_points': 0}
        gps_after = None
        for _ in range(100):
            gps_params = {
                'vehicleIds': ids_param,
                'types': 'gps',
                'startTime': start_time,
                'endTime': end_time,
            }
            if gps_after:
                gps_params['after'] = gps_after
            info['api_calls'] += 1
            gresp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/vehicles/stats/history',
                headers=headers, params=gps_params, timeout=30,
            )
            if gresp.status_code != 200:
                info['errors'].append(f'gps/history HTTP {gresp.status_code}: {gresp.text[:300]}')
                break
            gdata = gresp.json()
            for entry in gdata.get('data', []):
                vid = entry.get('id', '')
                if vid not in daily_location:
                    daily_location[vid] = {}
                for gps_point in entry.get('gps', []):
                    ts = gps_point.get('time', '')
                    if not ts:
                        continue
                    info['gps_points'] += 1
                    try:
                        dt = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(CET)
                        dk = dt.strftime('%Y-%m-%d')
                    except Exception:
                        continue
                    lat = gps_point.get('latitude', 0)
                    lng = gps_point.get('longitude', 0)
                    reverse_geo = gps_point.get('reverseGeo', {}) or {}
                    address = reverse_geo.get('formattedLocation', '')
                    if lat and lng:
                        daily_points.setdefault(vid, {}).setdefault(dk, []).append((ts, lat, lng))
                    existing = daily_location[vid].get(dk)
                    if not existing or ts > existing.get('time', ''):
                        daily_location[vid][dk] = {'address': address, 'lat': lat, 'lng': lng, 'time': ts}
            gpag = gdata.get('pagination', {})
            if gpag.get('hasNextPage') and gpag.get('endCursor'):
                gps_after = gpag['endCursor']
            else:
                break

        # Calculate daily distance from GPS breadcrumbs
        for vid, day_pts in daily_points.items():
            if vid not in daily_km:
                daily_km[vid] = {}
            for dk, pts in day_pts.items():
                if len(pts) < 2:
                    continue
                pts.sort(key=lambda p: p[0])
                total_dist = 0.0
                for i in range(1, len(pts)):
                    d = _haversine_km(pts[i-1][1], pts[i-1][2], pts[i][1], pts[i][2])
                    if d < 10.0:
                        total_dist += d
                if total_dist > 0.1:
                    daily_km[vid][dk] = round(total_dist, 1)

        info['gps_vehicles_with_location'] = len([v for v in daily_location.values() if v])
        info['gps_distance_days'] = sum(len(d) for d in daily_km.values())
        return daily_location, daily_km, info

    # ---- Step 1: Always fetch trips (lightweight, has distance + addresses) ----
    all_trips, trips_info = _fetch_trips()
    debug_info['api_calls'] += trips_info['api_calls']
    debug_info['raw_trips'] = trips_info['raw_trips']
    debug_info['errors'].extend(trips_info['errors'])

    # ---- Step 2+3: Always fetch stats (odometer) ----
    stats_daily_km = {}
    current_app.logger.info('Fetching stats/odometer for accuracy')
    stats_daily_km, stats_info = _fetch_stats()
    debug_info['api_calls'] += stats_info['api_calls']
    debug_info['errors'].extend(stats_info.get('errors', []))
    debug_info['stats_vehicles'] = stats_info.get('stats_vehicles', 0)
    debug_info['stats_daily_entries'] = stats_info.get('stats_daily_entries', 0)
    debug_info['stats_source'] = stats_info.get('stats_source', 'none')

    # ---- Step 4: Always fetch GPS breadcrumbs ----
    gps_daily_location = {}
    gps_daily_km = {}
    current_app.logger.info('Fetching GPS breadcrumbs for accuracy')
    gps_daily_location, gps_daily_km, gps_info = _fetch_gps()
    debug_info['api_calls'] += gps_info['api_calls']
    debug_info['errors'].extend(gps_info.get('errors', []))
    debug_info['gps_points'] = gps_info.get('gps_points', 0)
    debug_info['gps_vehicles_with_location'] = gps_info.get('gps_vehicles_with_location', 0)
    debug_info['gps_distance_days'] = gps_info.get('gps_distance_days', 0)

    # ---------- Group trips by vehicle and then by day ----------
    # Trip object structure (Samsara) may vary:
    #   tripStartTime, tripEndTime, distanceMeters (or other field names),
    #   startLocation{latitude,longitude,formattedAddress},
    #   endLocation{latitude,longitude,formattedAddress},
    #   asset{id,name}
    vehicle_trips = {}  # vid -> list of trips

    # Log a sample raw trip for debugging
    if all_trips:
        sample = all_trips[0]
        debug_info['sample_trip_keys'] = list(sample.keys())
        # Include sample values for distance-related fields
        for k in sample.keys():
            if 'dist' in k.lower() or 'meter' in k.lower() or 'mile' in k.lower() or 'km' in k.lower() or 'odometer' in k.lower():
                debug_info[f'sample_{k}'] = sample.get(k)

    for trip in all_trips:
        asset = trip.get('asset', {})
        vid = asset.get('id', '')
        if not vid:
            vid = vehicle_ids[0] if len(vehicle_ids) == 1 else ''
        if vid not in vehicle_trips:
            vehicle_trips[vid] = {
                'name': asset.get('name', vid),
                'trips': [],
            }
        vehicle_trips[vid]['trips'].append(trip)

    # Process each vehicle's trips into daily summaries
    results = []

    for vid, vdata in vehicle_trips.items():
        daily = {}  # date_str -> {first_start, last_end, total_meters, trips_count, end_address}
        vid_stats = stats_daily_km.get(vid, {})

        for trip in vdata['trips']:
            t_start = trip.get('tripStartTime', '')
            t_end = trip.get('tripEndTime', '')
            # Try multiple field names for distance
            dist = (
                trip.get('distanceMeters')
                or trip.get('distance_meters')
                or trip.get('distanceM')
                or trip.get('distance')
                or 0
            )
            dist = float(dist) if dist else 0

            if not t_start:
                continue

            try:
                dt_start = datetime.fromisoformat(
                    t_start.replace('Z', '+00:00')
                ).astimezone(CET)
            except Exception:
                continue

            try:
                dt_end = datetime.fromisoformat(
                    t_end.replace('Z', '+00:00')
                ).astimezone(CET) if t_end else dt_start
            except Exception:
                dt_end = dt_start

            day_key = dt_start.strftime('%Y-%m-%d')

            # End location address
            end_loc = trip.get('endLocation', {})
            end_addr = end_loc.get('formattedAddress', '') if end_loc else ''

            if day_key not in daily:
                daily[day_key] = {
                    'first_start': dt_start,
                    'last_end': dt_end,
                    'total_meters': float(dist),
                    'trips_count': 1,
                    'end_address': end_addr,
                    'trips': [{
                        'start': dt_start.strftime('%H:%M'),
                        'end': dt_end.strftime('%H:%M'),
                        'km': round(float(dist) / 1000, 1),
                    }],
                }
            else:
                d = daily[day_key]
                if dt_start < d['first_start']:
                    d['first_start'] = dt_start
                if dt_end > d['last_end']:
                    d['last_end'] = dt_end
                    d['end_address'] = end_addr
                d['total_meters'] += float(dist)
                d['trips_count'] += 1
                d['trips'].append({
                    'start': dt_start.strftime('%H:%M'),
                    'end': dt_end.strftime('%H:%M'),
                    'km': round(float(dist) / 1000, 1),
                })

        # Build daily entries
        days = []
        total_km = 0.0
        distance_source = 'trips'

        for day_key in sorted(daily.keys()):
            d = daily[day_key]
            start_dt = d['first_start']
            end_dt = d['last_end']
            trip_dist_km = round(d['total_meters'] / 1000, 1)
            stats_dist_km = vid_stats.get(day_key, 0)

            gps_dist_km = gps_daily_km.get(vid, {}).get(day_key, 0)

            # Use the highest value from all sources for accuracy
            dist_km = max(trip_dist_km, stats_dist_km, gps_dist_km)
            if dist_km == stats_dist_km and stats_dist_km > 0:
                distance_source = 'stats'
            elif dist_km == gps_dist_km and gps_dist_km > 0:
                distance_source = 'gps'
            total_km += dist_km

            dur_min = int((end_dt - start_dt).total_seconds() / 60) if end_dt > start_dt else 0
            dur_h = dur_min // 60
            dur_m = dur_min % 60

            # Last location: prefer trip endLocation, fall back to GPS
            last_loc = d['end_address']
            if not last_loc:
                gps_loc = gps_daily_location.get(vid, {}).get(day_key, {})
                last_loc = gps_loc.get('address', '')

            days.append({
                'date': day_key,
                'begin_driving': start_dt.strftime('%Y-%m-%d %H:%M'),
                'last_driving': end_dt.strftime('%Y-%m-%d %H:%M'),
                'duration_h': dur_h,
                'duration_m': dur_m,
                'duration_hm': f'{dur_h}h' if dur_m == 0 else f'{dur_h}h {dur_m}m',
                'duration_minutes': dur_min,
                'distance_km': dist_km,
                'trips_count': d['trips_count'],
                'last_location': last_loc,
                'trips': d.get('trips', []),
            })

        results.append({
            'vehicle_id': vid,
            'vehicle_name': vdata['name'],
            'days': days,
            'total_km': round(total_km, 1),
            'active_days': len(days),
            'distance_source': distance_source,
        })

    # Add vehicles that have stats data but no trips
    for vid in vehicle_ids:
        if vid not in vehicle_trips and vid in stats_daily_km and stats_daily_km[vid]:
            vid_stats = stats_daily_km[vid]
            vname = vid  # frontend maps to real name from vehicle list

            days = []
            total_km = 0.0
            for day_key in sorted(vid_stats.keys()):
                sk = vid_stats[day_key]
                if sk > 0:
                    gps_loc = gps_daily_location.get(vid, {}).get(day_key, {})
                    days.append({
                        'date': day_key,
                        'begin_driving': '',
                        'last_driving': '',
                        'duration_h': 0,
                        'duration_m': 0,
                        'duration_hm': '-',
                        'duration_minutes': 0,
                        'distance_km': sk,
                        'trips_count': 0,
                        'last_location': gps_loc.get('address', ''),
                    })
                    total_km += sk

            if days:
                results.append({
                    'vehicle_id': vid,
                    'vehicle_name': vname,
                    'days': days,
                    'total_km': round(total_km, 1),
                    'active_days': len(days),
                    'distance_source': 'stats',
                })

    # Add vehicles that have only GPS data (no trips, no stats)
    vids_with_results = {r['vehicle_id'] for r in results}
    for vid in vehicle_ids:
        if vid not in vids_with_results and vid in gps_daily_km and gps_daily_km[vid]:
            vname = vid
            days = []
            total_km = 0.0
            for day_key in sorted(gps_daily_km[vid].keys()):
                gk = gps_daily_km[vid][day_key]
                if gk > 0:
                    gps_loc = gps_daily_location.get(vid, {}).get(day_key, {})
                    days.append({
                        'date': day_key,
                        'begin_driving': '',
                        'last_driving': '',
                        'duration_h': 0,
                        'duration_m': 0,
                        'duration_hm': '-',
                        'duration_minutes': 0,
                        'distance_km': gk,
                        'trips_count': 0,
                        'last_location': gps_loc.get('address', ''),
                    })
                    total_km += gk

            if days:
                results.append({
                    'vehicle_id': vid,
                    'vehicle_name': vname,
                    'days': days,
                    'total_km': round(total_km, 1),
                    'active_days': len(days),
                    'distance_source': 'gps',
                })

    results.sort(key=lambda r: r['vehicle_name'])

    debug_info['vehicles_with_data'] = len(results)
    debug_info['total_days'] = sum(r['active_days'] for r in results)
    _log_activity('vehicles_activity', f'{period}: {len(all_trips)} trips, {len(results)} vehicles')

    # Save to cache
    response_data = {'period': period, 'vehicles': results, 'debug': debug_info}
    VEHICLE_ACTIVITY_CACHE[cache_key] = (datetime.now(), response_data)
    # Evict old cache entries
    now = datetime.now()
    stale = [k for k, (ts, _) in VEHICLE_ACTIVITY_CACHE.items()
             if (now - ts).total_seconds() > VEHICLE_ACTIVITY_CACHE_TTL * 2]
    for k in stale:
        VEHICLE_ACTIVITY_CACHE.pop(k, None)

    return jsonify(response_data)


@bp.route('/api/vehicles/odometer', methods=['GET'])
@permission_required('vehicles')
def api_vehicles_odometer():
    """
    OBD odometer data for vehicles from Samsara.

    Query params:
      vehicle_ids   comma-separated Samsara vehicle IDs (optional, all if omitted)
      date_from     YYYY-MM-DD  range start (CET)  → triggers range mode
      date_to       YYYY-MM-DD  range end   (CET)  → triggers range mode
      (omit both for current-reading mode)
    """
    import re

    if not SAMSARA_API_TOKEN:
        return jsonify({'error': 'Samsara API not configured'}), 400

    vehicle_ids_param = request.args.get('vehicle_ids', '')
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()

    headers = {'Authorization': f'Bearer {SAMSARA_API_TOKEN}'}

    # ── fetch vehicle metadata ──────────────────────────────────────────────
    vehicle_meta = {}
    after = None
    for _ in range(20):
        params = {'limit': 100}
        if after:
            params['after'] = after
        try:
            resp = http_requests.get(
                f'{SAMSARA_API_BASE}/fleet/vehicles',
                headers=headers, params=params, timeout=15,
            )
            if resp.status_code != 200:
                return jsonify({'error': f'Samsara vehicles error: {resp.status_code}'}), 502
            data = resp.json()
        except Exception as e:
            return jsonify({'error': str(e)}), 502
        for v in data.get('data', []):
            vehicle_meta[v.get('id', '')] = {
                'name': v.get('name', ''),
                'license_plate': v.get('licensePlate', ''),
                'vin': v.get('vin', ''),
            }
        pag = data.get('pagination', {})
        if pag.get('hasNextPage') and pag.get('endCursor'):
            after = pag['endCursor']
        else:
            break

    ids_list = [v.strip() for v in vehicle_ids_param.split(',') if v.strip()] if vehicle_ids_param else list(vehicle_meta.keys())
    if not ids_list:
        return jsonify({'vehicles': [], 'mode': 'current'})

    # ── range mode ──────────────────────────────────────────────────────────
    if date_from and date_to:
        date_pat = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        if not date_pat.match(date_from) or not date_pat.match(date_to):
            return jsonify({'error': 'Invalid date format (expected YYYY-MM-DD)'}), 400
        if date_from > date_to:
            return jsonify({'error': 'date_from must be <= date_to'}), 400

        # Single Samsara call covering the whole CET range
        start_utc = (
            datetime.fromisoformat(f'{date_from}T00:00:00')
            .replace(tzinfo=CET)
            .astimezone(timezone.utc)
            .strftime('%Y-%m-%dT%H:%M:%SZ')
        )
        end_utc = (
            datetime.fromisoformat(f'{date_to}T23:59:59')
            .replace(tzinfo=CET)
            .astimezone(timezone.utc)
            .strftime('%Y-%m-%dT%H:%M:%SZ')
        )

        def ts_to_cet_date(ts: str) -> str:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(CET)
            return dt.strftime('%Y-%m-%d')

        # Group readings: {vid: {date_str: [(ts, meters)]}}
        daily: dict = {}
        ids_param = ','.join(ids_list[:50])
        stat_after = None
        for _ in range(100):
            stat_params = {
                'vehicleIds': ids_param,
                'types': 'obdOdometerMeters',
                'startTime': start_utc,
                'endTime': end_utc,
            }
            if stat_after:
                stat_params['after'] = stat_after
            try:
                sresp = http_requests.get(
                    f'{SAMSARA_API_BASE}/fleet/vehicles/stats/history',
                    headers=headers, params=stat_params, timeout=30,
                )
                if sresp.status_code != 200:
                    return jsonify({'error': f'Samsara stats/history error: {sresp.status_code}'}), 502
                sdata = sresp.json()
            except Exception as e:
                return jsonify({'error': str(e)}), 502

            for entry in sdata.get('data', []):
                vid = entry.get('id', '')
                for pt in entry.get('obdOdometerMeters', []):
                    val = pt.get('value')
                    ts = pt.get('time', '')
                    if val is None or not ts:
                        continue
                    cet_day = ts_to_cet_date(ts)
                    if cet_day < date_from or cet_day > date_to:
                        continue
                    daily.setdefault(vid, {}).setdefault(cet_day, []).append((ts, float(val)))

            pag = sdata.get('pagination', {})
            if pag.get('hasNextPage') and pag.get('endCursor'):
                stat_after = pag['endCursor']
            else:
                break

        rows = []
        for vid in ids_list:
            meta = vehicle_meta.get(vid, {'name': vid, 'license_plate': '', 'vin': ''})
            vehicle_days = daily.get(vid, {})
            for day in sorted(vehicle_days.keys()):
                pts = sorted(vehicle_days[day], key=lambda x: x[0])
                odo_start = pts[0][1]
                odo_end = pts[-1][1]
                driven = max(0.0, round((odo_end - odo_start) / 1000, 1))
                rows.append({
                    'vehicle_id': vid,
                    'vehicle_name': meta['name'],
                    'license_plate': meta['license_plate'],
                    'date': day,
                    'odometer_start_km': round(odo_start / 1000, 0),
                    'odometer_end_km': round(odo_end / 1000, 0),
                    'driven_km': driven,
                    'readings_count': len(pts),
                })

        _log_activity(
            'vehicles_odometer_range',
            f'{date_from}–{date_to}: {len(rows)} vehicle-day rows',
        )
        return jsonify({
            'rows': rows,
            'mode': 'range',
            'date_from': date_from,
            'date_to': date_to,
        })

    # ── current mode ────────────────────────────────────────────────────────
    ids_param = ','.join(ids_list[:50])
    try:
        cresp = http_requests.get(
            f'{SAMSARA_API_BASE}/fleet/vehicles/stats',
            headers=headers,
            params={'vehicleIds': ids_param, 'types': 'obdOdometerMeters'},
            timeout=15,
        )
        if cresp.status_code != 200:
            return jsonify({'error': f'Samsara stats error: {cresp.status_code}'}), 502
        cdata = cresp.json()
    except Exception as e:
        return jsonify({'error': str(e)}), 502

    results = []
    for entry in cdata.get('data', []):
        vid = entry.get('id', '')
        meta = vehicle_meta.get(vid, {'name': vid, 'license_plate': '', 'vin': ''})
        odo_list = entry.get('obdOdometerMeters', [])
        if odo_list:
            latest = odo_list[0]
            odo_m = float(latest.get('value', 0) or 0)
            ts = latest.get('time', '')
        else:
            odo_m = 0.0
            ts = ''
        results.append({
            'vehicle_id': vid,
            'vehicle_name': meta['name'],
            'license_plate': meta['license_plate'],
            'odometer_km': round(odo_m / 1000, 0),
            'updated_at': ts,
        })

    results.sort(key=lambda r: r['vehicle_name'])
    _log_activity('vehicles_odometer_current', f'{len(results)} vehicles')
    return jsonify({'vehicles': results, 'mode': 'current'})
