import json
import os
import re
from datetime import datetime

from flask import Blueprint, request, jsonify, session

from auth.decorators import login_required, admin_required
from auth.helpers import (
    _log_activity,
    _log_config_change,
    _get_db,
    _load_users,
    _load_config,
    _save_config,
    get_login_history,
    get_activity_log,
    get_user_by_name,
    get_user_by_id,
    create_user,
    update_user,
    delete_user,
)
from config import SAMSARA_API_TOKEN, ROLE_PERMISSIONS, VALID_ROLES
from core.constants import UTC
from core.utils import _sanitize_text
import config as cfg_mod

bp = Blueprint('admin', __name__)


# --- Login / activity history ---


@bp.route('/api/admin/login-history')
@admin_required
def api_login_history():
    """Return login history, newest first (admin only)."""
    return jsonify({'history': get_login_history(500)})


@bp.route('/api/admin/activity-log')
@admin_required
def api_activity_log():
    """Return the API activity log, newest first."""
    return jsonify({'log': get_activity_log(1000)})


@bp.route('/api/mindestlohn/settings', methods=['GET'])
@login_required
def api_mindestlohn_settings():
    """Company-wide MiLoG parameters (login-only, not admin-only).

    The analysis view reads this to flag drivers whose effective €/h falls
    below the floor. The per-driver override lives on
    ``driver_config.monthly_gross_eur`` and is returned with the driver
    configs, not here.
    """
    cfg = _load_config()
    try:
        default_gross = float(cfg.get('mindestlohn_default_monthly_gross_eur', 2750.0) or 0.0)
    except (TypeError, ValueError):
        default_gross = 2750.0
    try:
        min_hourly = float(cfg.get('mindestlohn_min_hourly_eur', 14.0) or 14.0)
    except (TypeError, ValueError):
        min_hourly = 14.0
    return jsonify({
        'default_monthly_gross_eur': default_gross,
        'min_hourly_eur': min_hourly,
    })


# --- Driver config ---


@bp.route('/api/driver-config')
@login_required
def api_list_driver_configs():
    """List all driver configs."""
    conn = _get_db()
    rows = conn.execute('SELECT * FROM driver_config ORDER BY driver_name').fetchall()
    conn.close()
    return jsonify({'configs': [dict(r) for r in rows]})


@bp.route('/api/driver-config/<card_number>')
@login_required
def api_get_driver_config(card_number):
    """Get config for a specific driver by card number."""
    conn = _get_db()
    row = conn.execute('SELECT * FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()
    conn.close()
    if row:
        return jsonify(dict(row))
    return jsonify({
        'card_number': card_number,
        'driver_name': '',
        'personal_nr': '',
        'double_diet': 0,
        'diet_rate': 14.0,
        'monthly_gross_eur': 0.0,
        'charter_enabled': 0,
        'notes': '',
        'night_40_enabled': 1,
    })


@bp.route('/api/driver-config', methods=['POST'])
@admin_required
def api_upsert_driver_config():
    """Create or update a driver config."""
    data = request.get_json(silent=True) or {}
    card_number = _sanitize_text(data.get('card_number', ''), 50)
    if not card_number:
        return jsonify({'error': 'card_number required'}), 400
    if not re.match(r'^[A-Za-z0-9_ .\-/]+$', card_number):
        return jsonify({'error': 'Invalid card_number format'}), 400

    driver_name = _sanitize_text(data.get('driver_name', ''), 200)
    personal_nr = _sanitize_text(data.get('personal_nr', ''), 50)
    notes = _sanitize_text(data.get('notes', ''), 500)
    double_diet = 1 if data.get('double_diet') else 0
    charter_enabled = 1 if data.get('charter_enabled') else 0
    night_40_enabled = 1 if data.get('night_40_enabled', True) else 0

    try:
        diet_rate = float(data.get('diet_rate', 14.0))
        if diet_rate < 0 or diet_rate > 999:
            diet_rate = 14.0
    except (ValueError, TypeError):
        diet_rate = 14.0

    try:
        monthly_gross_eur = float(data.get('monthly_gross_eur', 0.0) or 0.0)
        if monthly_gross_eur < 0 or monthly_gross_eur > 100000:
            monthly_gross_eur = 0.0
    except (ValueError, TypeError):
        monthly_gross_eur = 0.0

    now = datetime.now(UTC).isoformat()
    conn = _get_db()
    existing = conn.execute('SELECT * FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()

    changes = []
    if existing:
        old = dict(existing)
        field_map = {'driver_name': driver_name, 'personal_nr': personal_nr, 'double_diet': double_diet, 'diet_rate': diet_rate, 'monthly_gross_eur': monthly_gross_eur, 'charter_enabled': charter_enabled, 'notes': notes, 'night_40_enabled': night_40_enabled}
        for field, new_val in field_map.items():
            old_val = old.get(field, '')
            if str(old_val) != str(new_val):
                changes.append({'field': field, 'old': old_val, 'new': new_val})
        conn.execute('''
            UPDATE driver_config SET
                driver_name = ?, personal_nr = ?, double_diet = ?,
                diet_rate = ?, monthly_gross_eur = ?, charter_enabled = ?, notes = ?, night_40_enabled = ?, updated_at = ?
            WHERE card_number = ?
        ''', (driver_name, personal_nr, double_diet, diet_rate, monthly_gross_eur, charter_enabled, notes, night_40_enabled, now, card_number))
    else:
        changes.append({'field': '*', 'old': '', 'new': 'created'})
        conn.execute('''
            INSERT INTO driver_config (card_number, driver_name, personal_nr, double_diet, diet_rate, monthly_gross_eur, charter_enabled, notes, night_40_enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (card_number, driver_name, personal_nr, double_diet, diet_rate, monthly_gross_eur, charter_enabled, notes, night_40_enabled, now, now))

    conn.commit()
    conn.close()
    try:
        from routes.analysis import _analysis_cache
        _analysis_cache.clear()
    except Exception:
        pass
    _log_activity('save_driver_config', f"{card_number} — {driver_name}")
    _log_config_change('save_driver_config', f"{card_number} — {driver_name}", card_number=card_number, driver_name=driver_name, changes=changes)
    return jsonify({'ok': True})


@bp.route('/api/driver-config/bulk', methods=['POST'])
@admin_required
def api_bulk_driver_config():
    """Bulk update driver configs. Expects {card_numbers: [...], updates: {...}}."""
    data = request.get_json(silent=True) or {}
    card_numbers = data.get('card_numbers', [])
    updates = data.get('updates', {})

    if not card_numbers or not isinstance(card_numbers, list):
        return jsonify({'error': 'card_numbers list required'}), 400
    if len(card_numbers) > 200:
        return jsonify({'error': 'Too many card numbers (max 200)'}), 400
    if not updates:
        return jsonify({'error': 'updates required'}), 400

    now = datetime.now(UTC).isoformat()
    conn = _get_db()
    count = 0

    for cn in card_numbers:
        cn = _sanitize_text(str(cn), 50)
        if not cn:
            continue
        existing = conn.execute('SELECT id FROM driver_config WHERE card_number = ?', (cn,)).fetchone()
        if existing:
            # Build partial update
            sets = ['updated_at = ?']
            vals = [now]
            if 'double_diet' in updates:
                sets.append('double_diet = ?')
                vals.append(1 if updates['double_diet'] else 0)
            if 'diet_rate' in updates:
                try:
                    rate = float(updates['diet_rate'])
                    if 0 <= rate <= 999:
                        sets.append('diet_rate = ?')
                        vals.append(rate)
                except (ValueError, TypeError):
                    pass
            if 'monthly_gross_eur' in updates:
                try:
                    g = float(updates['monthly_gross_eur'] or 0.0)
                    if 0 <= g <= 100000:
                        sets.append('monthly_gross_eur = ?')
                        vals.append(g)
                except (ValueError, TypeError):
                    pass
            if 'charter_enabled' in updates:
                sets.append('charter_enabled = ?')
                vals.append(1 if updates['charter_enabled'] else 0)
            if 'personal_nr' in updates:
                sets.append('personal_nr = ?')
                vals.append(_sanitize_text(str(updates['personal_nr']), 50))
            if 'notes' in updates:
                sets.append('notes = ?')
                vals.append(_sanitize_text(str(updates['notes']), 500))
            if 'night_40_enabled' in updates:
                sets.append('night_40_enabled = ?')
                vals.append(1 if updates['night_40_enabled'] else 0)
            vals.append(cn)
            conn.execute(f"UPDATE driver_config SET {', '.join(sets)} WHERE card_number = ?", vals)
        else:
            # Create with defaults + updates
            double_diet = 1 if updates.get('double_diet') else 0
            night_40_enabled = 1 if updates.get('night_40_enabled', True) else 0
            try:
                diet_rate = float(updates.get('diet_rate', 14.0))
                if diet_rate < 0 or diet_rate > 999:
                    diet_rate = 14.0
            except (ValueError, TypeError):
                diet_rate = 14.0
            try:
                monthly_gross_eur = float(updates.get('monthly_gross_eur', 0.0) or 0.0)
                if monthly_gross_eur < 0 or monthly_gross_eur > 100000:
                    monthly_gross_eur = 0.0
            except (ValueError, TypeError):
                monthly_gross_eur = 0.0
            charter_enabled = 1 if updates.get('charter_enabled') else 0
            conn.execute('''
                INSERT INTO driver_config (card_number, driver_name, personal_nr, double_diet, diet_rate, monthly_gross_eur, charter_enabled, notes, night_40_enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                cn, '', _sanitize_text(str(updates.get('personal_nr', '')), 50),
                double_diet, diet_rate, monthly_gross_eur, charter_enabled,
                _sanitize_text(str(updates.get('notes', '')), 500),
                night_40_enabled, now, now,
            ))
        count += 1

    conn.commit()
    conn.close()
    _log_activity('bulk_driver_config', f"{count} drivers updated")
    _log_config_change('bulk_driver_config', f"{count} drivers updated")
    return jsonify({'ok': True, 'updated': count})


@bp.route('/api/driver-config/<int:config_id>', methods=['DELETE'])
@admin_required
def api_delete_driver_config(config_id):
    """Delete a driver config."""
    conn = _get_db()
    conn.execute('DELETE FROM driver_config WHERE id = ?', (config_id,))
    conn.commit()
    conn.close()
    _log_activity('delete_driver_config', f"id={config_id}")
    _log_config_change('delete_driver_config', f"id={config_id}")
    return jsonify({'ok': True})


# --- Config audit log ---


@bp.route('/api/admin/config-history')
@admin_required
def api_config_history():
    """Return recent config change audit log entries."""
    card_number = request.args.get('card_number', '')
    limit = min(int(request.args.get('limit', 100)), 500)
    conn = _get_db()
    if card_number:
        rows = conn.execute(
            'SELECT * FROM config_audit_log WHERE card_number = ? ORDER BY changed_at DESC LIMIT ?',
            (card_number, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            'SELECT * FROM config_audit_log ORDER BY changed_at DESC LIMIT ?',
            (limit,)
        ).fetchall()
    conn.close()
    entries = [dict(r) for r in rows]
    return jsonify({'entries': entries})


# --- User management ---


@bp.route('/api/admin/roles')
@admin_required
def api_list_roles():
    """Return available roles and their default permissions."""
    return jsonify({'roles': ROLE_PERMISSIONS})


@bp.route('/api/admin/users')
@admin_required
def api_list_users():
    users = _load_users()
    safe = [{'id': u['id'], 'name': u['name'], 'role': u['role'],
             'permissions': u['permissions'], 'is_active': u['is_active'],
             'created': u['created']} for u in users]
    return jsonify({'users': safe})


@bp.route('/api/admin/users', methods=['POST'])
@admin_required
def api_create_user():
    data = request.get_json(silent=True) or {}
    name = str(data.get('name', '')).strip()
    password = str(data.get('password', ''))
    role = data.get('role', 'user')
    if not name or not password:
        return jsonify({'error': 'Name and password required'}), 400
    if len(name) > 100 or not re.match(r'^[\w.@+\- ]+$', name):
        return jsonify({'error': 'Invalid user name'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Password must have at least 8 characters'}), 400
    if role not in VALID_ROLES:
        role = 'user'
    permissions = data.get('permissions', [])
    if not isinstance(permissions, list):
        permissions = []
    if get_user_by_name(name):
        return jsonify({'error': 'User name already taken'}), 409
    new_id = create_user(name, password, role, permissions)
    _log_activity('create_user', f"{name} ({role})")
    return jsonify({'ok': True, 'id': new_id})


@bp.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def api_delete_user(user_id):
    if session.get('user_id') == user_id:
        return jsonify({'error': 'You cannot delete your own account'}), 400
    if not delete_user(user_id):
        return jsonify({'error': 'User not found'}), 404
    _log_activity('delete_user', f"id={user_id}")
    return jsonify({'ok': True})


@bp.route('/api/admin/users/<int:user_id>', methods=['PATCH'])
@admin_required
def api_update_user(user_id):
    """Update a user's name / role / permissions / password / active flag.

    ``permissions`` is the user's *extra* feature grants on top of the role
    defaults — see :data:`ROLE_PERMISSIONS`. Unknown feature keys are dropped.
    """
    data = request.get_json(silent=True) or {}
    target = get_user_by_id(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404

    fields = {}
    if 'role' in data:
        role = data.get('role') or 'user'
        if role not in VALID_ROLES:
            return jsonify({'error': f'invalid role: {role}'}), 400
        if session.get('user_id') == user_id and role != 'admin':
            return jsonify({'error': 'You cannot remove your own admin role'}), 400
        if target['role'] != role:
            fields['role'] = role
    if 'permissions' in data:
        perms_in = data.get('permissions') or []
        if not isinstance(perms_in, list):
            return jsonify({'error': 'permissions must be a list'}), 400
        fields['permissions'] = perms_in
    if data.get('password'):
        if len(str(data['password'])) < 8:
            return jsonify({'error': 'Password must have at least 8 characters'}), 400
        fields['password'] = str(data['password'])
    if 'name' in data:
        new_name = str(data['name']).strip()
        if new_name and new_name != target['name']:
            other = get_user_by_name(new_name)
            if other and other['id'] != user_id:
                return jsonify({'error': 'User name already taken'}), 409
            fields['name'] = new_name
    if 'is_active' in data:
        if session.get('user_id') == user_id and not data['is_active']:
            return jsonify({'error': 'You cannot deactivate your own account'}), 400
        fields['is_active'] = bool(data['is_active'])

    changed = update_user(user_id, **fields) if fields else []
    if changed:
        _log_activity('update_user', f"id={user_id} ({', '.join(changed)})")
    return jsonify({'ok': True, 'changed': changed})


# --- Sync config ---


@bp.route('/api/admin/config')
@admin_required
def api_get_config():
    cfg = _load_config()
    return jsonify({
        'samsara_api_token': cfg.get('samsara_api_token', SAMSARA_API_TOKEN[:8] + '...' if SAMSARA_API_TOKEN else ''),
        'samsara_api_token_set': bool(SAMSARA_API_TOKEN or cfg.get('samsara_api_token')),
        'sync_dest_folder': cfg.get('sync_dest_folder', os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')),
        'night_start_hour': int(cfg.get('night_start_hour', 22)),
        'parser_engine': cfg.get('parser_engine', 'tachoparser'),
        'pause_cap_enabled': bool(cfg.get('pause_cap_enabled', False)),
        'weekend_diet': bool(cfg.get('weekend_diet', False)),
        'night_includes_breaks': bool(cfg.get('night_includes_breaks', False)),
        'hidden_features': cfg.get('hidden_features', []),
        'company_name': cfg.get('company_name', 'LTS Logistik GmbH'),
        'mindestlohn_default_monthly_gross_eur': float(cfg.get('mindestlohn_default_monthly_gross_eur', 2750.0) or 0.0),
        'mindestlohn_min_hourly_eur': float(cfg.get('mindestlohn_min_hourly_eur', 14.0) or 0.0),
    })


@bp.route('/api/admin/config', methods=['POST'])
@admin_required
def api_update_config():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    for key in ('samsara_api_token', 'sync_dest_folder'):
        if key in data and data[key]:
            cfg[key] = data[key]
    if 'night_start_hour' in data:
        val = int(data['night_start_hour'])
        if val in (20, 21, 22):
            cfg['night_start_hour'] = val
    if 'parser_engine' in data and data['parser_engine'] in ('tachoparser', 'tachograph-go'):
        cfg['parser_engine'] = data['parser_engine']
    if 'pause_cap_enabled' in data:
        cfg['pause_cap_enabled'] = bool(data['pause_cap_enabled'])
    if 'weekend_diet' in data:
        cfg['weekend_diet'] = bool(data['weekend_diet'])
    if 'night_includes_breaks' in data:
        cfg['night_includes_breaks'] = bool(data['night_includes_breaks'])
    if 'hidden_features' in data:
        cfg['hidden_features'] = list(data['hidden_features']) if isinstance(data['hidden_features'], list) else []
    if 'company_name' in data:
        cfg['company_name'] = str(data['company_name'])[:100]
    if 'mindestlohn_default_monthly_gross_eur' in data:
        try:
            v = float(data['mindestlohn_default_monthly_gross_eur'])
            if 0 <= v <= 100000:
                cfg['mindestlohn_default_monthly_gross_eur'] = v
        except (TypeError, ValueError):
            pass
    if 'mindestlohn_min_hourly_eur' in data:
        try:
            v = float(data['mindestlohn_min_hourly_eur'])
            if 0 <= v <= 1000:
                cfg['mindestlohn_min_hourly_eur'] = v
        except (TypeError, ValueError):
            pass
    _save_config(cfg)
    # Clear analysis cache when settings change
    try:
        from routes.analysis import _analysis_cache
        _analysis_cache.clear()
    except Exception:
        pass
    # Update in-memory
    if 'samsara_api_token' in data and data['samsara_api_token']:
        cfg_mod.SAMSARA_API_TOKEN = data['samsara_api_token']
    _log_activity('update_config', ', '.join(data.keys()))
    _log_config_change('update_config', ', '.join(data.keys()))
    return jsonify({'ok': True})


@bp.route('/api/admin/stats')
@admin_required
def api_system_stats():
    """System statistics for admin dashboard."""
    conn = _get_db()
    try:
        driver_count = conn.execute('SELECT COUNT(*) FROM driver_config').fetchone()[0]
        monthly_count = conn.execute('SELECT COUNT(*) FROM driver_monthly_days').fetchone()[0]
        audit_count = conn.execute('SELECT COUNT(*) FROM config_audit_log').fetchone()[0]
    except Exception:
        driver_count = monthly_count = audit_count = 0
    finally:
        conn.close()

    # Analysis cache stats
    try:
        from routes.analysis import _analysis_cache
        cache_size = len(_analysis_cache)
    except Exception:
        cache_size = 0

    # DB file size
    db_size = 0
    try:
        db_path = os.environ.get('DATABASE_FILE', '/opt/ddd-reader/ddd_portal.db')
        if os.path.exists(db_path):
            db_size = os.path.getsize(db_path)
    except Exception:
        pass

    return jsonify({
        'driver_configs': driver_count,
        'monthly_records': monthly_count,
        'audit_entries': audit_count,
        'cache_entries': cache_size,
        'db_size_bytes': db_size,
    })
