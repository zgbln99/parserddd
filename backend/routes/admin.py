import json
import os
import re
from datetime import datetime

from flask import Blueprint, request, jsonify

from auth.decorators import login_required, admin_required
from auth.helpers import (
    _log_activity,
    _log_config_change,
    _get_db,
    _hash_password,
    _load_users,
    _save_users,
    _load_config,
    _save_config,
)
from config import (
    LOGIN_HISTORY_FILE,
    ACTIVITY_LOG_FILE,
    SAMSARA_API_TOKEN,
    DROPBOX_REFRESH_TOKEN,
    ROLE_PERMISSIONS,
)
from core.constants import UTC
from core.utils import _sanitize_text
import config as cfg_mod

bp = Blueprint('admin', __name__)


# --- Login / activity history ---


@bp.route('/api/admin/login-history')
@admin_required
def api_login_history():
    """Return login history (admin only)."""
    try:
        if os.path.exists(LOGIN_HISTORY_FILE):
            with open(LOGIN_HISTORY_FILE) as f:
                history = json.load(f)
            history.reverse()
            return jsonify({'history': history})
        return jsonify({'history': []})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/admin/activity-log')
@admin_required
def api_activity_log():
    """Return API activity log."""
    try:
        if os.path.exists(ACTIVITY_LOG_FILE):
            with open(ACTIVITY_LOG_FILE) as f:
                log = json.load(f)
            log.reverse()
            return jsonify({'log': log})
        return jsonify({'log': []})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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
    night_40_enabled = 1 if data.get('night_40_enabled', True) else 0

    try:
        diet_rate = float(data.get('diet_rate', 14.0))
        if diet_rate < 0 or diet_rate > 999:
            diet_rate = 14.0
    except (ValueError, TypeError):
        diet_rate = 14.0

    now = datetime.now(UTC).isoformat()
    conn = _get_db()
    existing = conn.execute('SELECT * FROM driver_config WHERE card_number = ?', (card_number,)).fetchone()

    changes = []
    if existing:
        old = dict(existing)
        field_map = {'driver_name': driver_name, 'personal_nr': personal_nr, 'double_diet': double_diet, 'diet_rate': diet_rate, 'notes': notes, 'night_40_enabled': night_40_enabled}
        for field, new_val in field_map.items():
            old_val = old.get(field, '')
            if str(old_val) != str(new_val):
                changes.append({'field': field, 'old': old_val, 'new': new_val})
        conn.execute('''
            UPDATE driver_config SET
                driver_name = ?, personal_nr = ?, double_diet = ?,
                diet_rate = ?, notes = ?, night_40_enabled = ?, updated_at = ?
            WHERE card_number = ?
        ''', (driver_name, personal_nr, double_diet, diet_rate, notes, night_40_enabled, now, card_number))
    else:
        changes.append({'field': '*', 'old': '', 'new': 'created'})
        conn.execute('''
            INSERT INTO driver_config (card_number, driver_name, personal_nr, double_diet, diet_rate, notes, night_40_enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (card_number, driver_name, personal_nr, double_diet, diet_rate, notes, night_40_enabled, now, now))

    conn.commit()
    conn.close()
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
            conn.execute('''
                INSERT INTO driver_config (card_number, driver_name, personal_nr, double_diet, diet_rate, notes, night_40_enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                cn, '', _sanitize_text(str(updates.get('personal_nr', '')), 50),
                double_diet, diet_rate, _sanitize_text(str(updates.get('notes', '')), 500),
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
    # Strip password hashes
    safe = [{'id': u.get('id'), 'name': u.get('name'), 'role': u.get('role', 'user'),
             'permissions': u.get('permissions', []),
             'created': u.get('created', '')} for u in users]
    return jsonify({'users': safe})


@bp.route('/api/admin/users', methods=['POST'])
@admin_required
def api_create_user():
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'user')
    if not name or not password:
        return jsonify({'error': 'Name and password required'}), 400
    if role not in ('user', 'admin', 'dispatcher', 'driver'):
        role = 'user'
    permissions = data.get('permissions', [])
    if not isinstance(permissions, list):
        permissions = []
    users = _load_users()
    new_id = max((u.get('id', 0) for u in users), default=0) + 1
    users.append({
        'id': new_id,
        'name': name,
        'password_hash': _hash_password(password),
        'role': role,
        'permissions': permissions,
        'created': datetime.now(UTC).isoformat(),
    })
    _save_users(users)
    _log_activity('create_user', f"{name} ({role})")
    return jsonify({'ok': True, 'id': new_id})


@bp.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def api_delete_user(user_id):
    users = _load_users()
    before = len(users)
    users = [u for u in users if u.get('id') != user_id]
    if len(users) == before:
        return jsonify({'error': 'User not found'}), 404
    _save_users(users)
    _log_activity('delete_user', f"id={user_id}")
    return jsonify({'ok': True})


# --- Password change ---


@bp.route('/api/admin/change-password', methods=['POST'])
@admin_required
def api_change_password():
    """Change portal or admin password (writes to config file, not env)."""
    data = request.get_json(silent=True) or {}
    target = data.get('target', '')  # 'portal' or 'admin'
    new_password = data.get('new_password', '')
    if target not in ('portal', 'admin') or not new_password:
        return jsonify({'error': 'Invalid target or empty password'}), 400
    cfg = _load_config()
    cfg[f'{target}_password'] = new_password
    _save_config(cfg)
    # Update in-memory variable
    if target == 'portal':
        cfg_mod.PORTAL_PASSWORD = new_password
    else:
        cfg_mod.ADMIN_PASSWORD = new_password
    _log_activity('change_password', target)
    _log_config_change('change_password', f"{target} password changed")
    return jsonify({'ok': True})


# --- Sync config ---


@bp.route('/api/admin/config')
@admin_required
def api_get_config():
    cfg = _load_config()
    return jsonify({
        'samsara_api_token': cfg.get('samsara_api_token', SAMSARA_API_TOKEN[:8] + '...' if SAMSARA_API_TOKEN else ''),
        'samsara_api_token_set': bool(SAMSARA_API_TOKEN or cfg.get('samsara_api_token')),
        'dropbox_refresh_token_set': bool(DROPBOX_REFRESH_TOKEN or cfg.get('dropbox_refresh_token')),
        'sync_dest_folder': cfg.get('sync_dest_folder', os.environ.get('SYNC_DEST_FOLDER', '/Samsara-DDD')),
        'night_start_hour': int(cfg.get('night_start_hour', 22)),
        'parser_engine': cfg.get('parser_engine', 'tachoparser'),
        'pause_cap_enabled': bool(cfg.get('pause_cap_enabled', False)),
        'weekend_diet': bool(cfg.get('weekend_diet', False)),
        'hidden_features': cfg.get('hidden_features', []),
    })


@bp.route('/api/admin/config', methods=['POST'])
@admin_required
def api_update_config():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    for key in ('samsara_api_token', 'dropbox_refresh_token', 'sync_dest_folder'):
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
    if 'hidden_features' in data:
        cfg['hidden_features'] = list(data['hidden_features']) if isinstance(data['hidden_features'], list) else []
    _save_config(cfg)
    # Update in-memory
    if 'samsara_api_token' in data and data['samsara_api_token']:
        cfg_mod.SAMSARA_API_TOKEN = data['samsara_api_token']
    if 'dropbox_refresh_token' in data and data['dropbox_refresh_token']:
        cfg_mod.DROPBOX_REFRESH_TOKEN = data['dropbox_refresh_token']
    _log_activity('update_config', ', '.join(data.keys()))
    _log_config_change('update_config', ', '.join(data.keys()))
    return jsonify({'ok': True})
