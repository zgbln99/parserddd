"""Service-to-service DDD context API for trusted internal consumers.

This endpoint is intentionally separate from the browser/session API. It is
protected by DDD_INTEGRATION_API_KEY and returns a compact, privacy-minimised
snapshot suitable for the LTS WhatsApp assistant.
"""

from __future__ import annotations

import hmac
import os
import re
import tempfile
import unicodedata
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from core.analysis import analyze_card
from core.parsers import parse_ddd_auto
from services.dropbox_service import (
    build_drivers_data,
    get_server_dropbox_client,
    load_portal_cache,
    save_portal_cache,
)
from auth.helpers import _load_config
from routes.analysis import _get_driver_analysis_flags

bp = Blueprint('integrations', __name__)


def _unauthorized():
    return jsonify({'error': 'unauthorized'}), 401


def _api_key_ok() -> bool:
    expected = (os.environ.get('DDD_INTEGRATION_API_KEY') or '').strip()
    if not expected:
        return False
    supplied = request.headers.get('X-API-Key', '').strip()
    auth = request.headers.get('Authorization', '').strip()
    if auth.lower().startswith('bearer '):
        supplied = auth[7:].strip()
    return bool(supplied) and hmac.compare_digest(supplied, expected)


def _normalize_name(value: str) -> str:
    folded = ''.join(
        ch for ch in unicodedata.normalize('NFKD', value or '')
        if not unicodedata.combining(ch)
    ).lower()
    return ' '.join(re.findall(r'[a-z0-9]+', folded))


def _name_tokens(value: str) -> set[str]:
    return {p for p in _normalize_name(value).split() if len(p) >= 2}


def _driver_list():
    cached = load_portal_cache()
    if cached is not None:
        return cached
    dbx = get_server_dropbox_client()
    if not dbx:
        return None
    sync_folder = os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')
    drivers = build_drivers_data(dbx, sync_folder)
    save_portal_cache(drivers)
    return drivers


def _match_driver(drivers, *, name: str = '', card_number: str = ''):
    card_number = re.sub(r'\s+', '', card_number or '').lower()
    if card_number:
        exact = []
        for d in drivers:
            cards = {str(d.get('card_number') or '').lower()}
            cards.update(str(f.get('card_number') or '').lower() for f in d.get('files') or [])
            if card_number in cards:
                exact.append(d)
        if len(exact) == 1:
            return exact[0], 1.0, []
        if len(exact) > 1:
            return None, 0.0, [d.get('name', '') for d in exact[:5]]

    wanted = _normalize_name(name)
    wanted_tokens = _name_tokens(name)
    if not wanted or not wanted_tokens:
        return None, 0.0, []

    scored = []
    for d in drivers:
        candidate = d.get('name') or ''
        norm = _normalize_name(candidate)
        tokens = _name_tokens(candidate)
        if not tokens:
            continue
        if norm == wanted:
            score = 1.0
        else:
            inter = len(tokens & wanted_tokens)
            union = len(tokens | wanted_tokens)
            score = inter / union if union else 0.0
            # Also reward a strong substring match such as "Jan Kowalski LKW".
            if wanted in norm or norm in wanted:
                score = max(score, 0.9)
        if score > 0:
            scored.append((score, d))

    if not scored:
        return None, 0.0, []
    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best = scored[0]
    if best_score < 0.66:
        return None, best_score, [d.get('name', '') for _, d in scored[:5]]
    if len(scored) > 1 and scored[1][0] >= best_score - 0.05:
        return None, best_score, [d.get('name', '') for _, d in scored[:5]]
    return best, best_score, []


def _analyze_latest(driver):
    files = [f for f in (driver.get('files') or []) if f.get('path')]
    if not files:
        return None, None
    files.sort(key=lambda f: (f.get('file_date') or '', f.get('modified') or ''), reverse=True)
    latest = files[0]

    dbx = get_server_dropbox_client()
    if not dbx:
        raise RuntimeError('storage_not_configured')
    metadata, response = dbx.files_download(latest['path'])

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.ddd', delete=False) as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name
        parsed = parse_ddd_auto(tmp_path)
        flags = _get_driver_analysis_flags(parsed)
        result = analyze_card(
            parsed,
            config_loader=_load_config,
            night_40_check_midnight=flags['night_40_check_midnight'],
            pause_cap_enabled=flags['pause_cap_enabled'],
            weekend_diet=flags['weekend_diet'],
            night_includes_breaks=flags['night_includes_breaks'],
        )
        return latest, result
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _compact_context(driver, latest, analysis, days: int):
    shifts = list(analysis.get('shift_details') or [])
    shifts.sort(key=lambda s: s.get('shift_date') or '')
    latest_shift_date = next((s.get('shift_date') for s in reversed(shifts) if s.get('shift_date')), '')

    cutoff = None
    if latest_shift_date:
        try:
            cutoff = datetime.strptime(latest_shift_date, '%Y-%m-%d').date() - timedelta(days=days - 1)
        except ValueError:
            cutoff = None

    compact_shifts = []
    for s in shifts:
        date_str = s.get('shift_date') or ''
        if cutoff and date_str:
            try:
                if datetime.strptime(date_str, '%Y-%m-%d').date() < cutoff:
                    continue
            except ValueError:
                pass
        compact_shifts.append({
            'date': date_str,
            'weekday': s.get('weekday'),
            'start': s.get('shift_start'),
            'end': s.get('shift_end'),
            'work': s.get('work_hm'),
            'driving': s.get('driving_hm'),
            'break': s.get('break_hm'),
            'availability': s.get('avail_hm'),
            'night25': s.get('night_25_hm'),
            'night40': s.get('night_40_hm'),
            'diet': bool(s.get('has_diet')),
            'vehicles': s.get('vehicles') or [],
            'distanceKm': s.get('distance_km', 0),
        })

    info = analysis.get('driver_info') or {}
    summary = analysis.get('summary') or {}
    vehicles = []
    seen = set()
    for s in compact_shifts:
        for plate in s.get('vehicles') or []:
            if plate and plate not in seen:
                seen.add(plate)
                vehicles.append(plate)

    return {
        'found': True,
        'driver': {
            'name': info.get('driver_name') or driver.get('name') or '',
            # Only a suffix is needed for operator verification; do not expose
            # the full tachograph card number to the language model.
            'cardSuffix': str(info.get('card_number') or driver.get('card_number') or '')[-6:],
        },
        'source': {
            'fileDate': latest.get('file_date') or '',
            'latestDownload': driver.get('latest_download') or latest.get('modified') or '',
            'dataThrough': latest_shift_date,
        },
        'summary': {
            'work': summary.get('total_work_hm'),
            'driving': summary.get('total_driving_hm'),
            'break': summary.get('total_break_hm'),
            'availability': summary.get('total_avail_hm'),
            'night25': summary.get('night_25_hm'),
            'night40': summary.get('night_40_hm'),
            'diets': summary.get('diet_count'),
            'shifts': summary.get('total_shifts'),
        },
        'vehicles': vehicles,
        'recentShifts': compact_shifts[-45:],
    }


@bp.route('/api/integrations/ddd/health')
def integration_health():
    if not _api_key_ok():
        return _unauthorized()
    return jsonify({
        'ok': True,
        'storageConfigured': get_server_dropbox_client() is not None,
    })


@bp.route('/api/integrations/ddd/context')
def integration_ddd_context():
    if not _api_key_ok():
        return _unauthorized()

    name = (request.args.get('name') or '').strip()
    card_number = (request.args.get('card_number') or '').strip()
    try:
        days = max(1, min(int(request.args.get('days') or 31), 45))
    except (TypeError, ValueError):
        days = 31

    if not name and not card_number:
        return jsonify({'error': 'name_or_card_number_required'}), 400

    try:
        drivers = _driver_list()
        if drivers is None:
            return jsonify({'error': 'storage_not_configured'}), 503
        driver, score, candidates = _match_driver(drivers, name=name, card_number=card_number)
        if not driver:
            return jsonify({
                'found': False,
                'reason': 'ambiguous_or_not_found',
                'matchScore': round(score, 3),
                'candidates': candidates,
            })

        latest, analysis = _analyze_latest(driver)
        if not latest or not analysis:
            return jsonify({'found': False, 'reason': 'no_ddd_files'})

        payload = _compact_context(driver, latest, analysis, days)
        payload['matchScore'] = round(score, 3)
        return jsonify(payload)
    except Exception as exc:
        return jsonify({'error': 'ddd_context_failed', 'detail': str(exc)}), 500
