"""
Auth Blueprint — login (username + password), logout, status, own password.
"""

from flask import Blueprint, request, jsonify, session

from auth.decorators import login_required
from auth.helpers import (
    _check_rate_limit, _record_failed_login, _clear_rate_limit,
    _record_login, _verify_password, _log_activity,
    get_user_by_name, get_user_by_id, update_user,
)
from auth.helpers import _load_config as _load_global_config
from config import ROLE_PERMISSIONS

bp = Blueprint('auth', __name__)

MIN_PASSWORD_LENGTH = 8


def _client_ip() -> str:
    return request.remote_addr or '0.0.0.0'


def _session_for(user: dict):
    session['logged_in'] = True
    session['user_id'] = user['id']
    session['role'] = user['role']
    session['username'] = user['name']
    session['permissions'] = user['permissions']


@bp.route('/api/auth/login', methods=['POST'])
def api_login():
    ip = _client_ip()
    if _check_rate_limit(ip):
        return jsonify({'error': 'Too many login attempts. Try again in 5 minutes.'}), 429

    data = request.get_json(silent=True) or {}
    username = str(data.get('username', '')).strip()
    password = str(data.get('password', ''))
    if not username or not password or len(username) > 100 or len(password) > 200:
        _record_failed_login(ip)
        return jsonify({'error': 'Nieprawidlowy login lub haslo'}), 401

    user = get_user_by_name(username)
    if not user or not user['is_active'] or not _verify_password(password, user['password_hash']):
        _record_failed_login(ip)
        return jsonify({'error': 'Nieprawidlowy login lub haslo'}), 401

    _session_for(user)
    _record_login(user['role'], user['name'])
    _clear_rate_limit(ip)
    perms = sorted(set(ROLE_PERMISSIONS.get(user['role'], []) + user['permissions']))
    return jsonify({'ok': True, 'role': user['role'], 'username': user['name'], 'permissions': perms})


@bp.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'ok': True})


@bp.route('/api/auth/status')
def api_auth_status():
    logged_in = bool(session.get('logged_in'))
    role = session.get('role', 'user')
    username = session.get('username', '')
    custom_perms = session.get('permissions', []) or []

    # Refresh role + permissions from the account so admin-side changes
    # apply on the next status poll; a deleted or disabled account is
    # logged out here.
    if logged_in and session.get('user_id'):
        user = get_user_by_id(int(session['user_id']))
        if not user or not user['is_active']:
            session.clear()
            logged_in, role, username, custom_perms = False, 'user', '', []
        else:
            role, username, custom_perms = user['role'], user['name'], user['permissions']
            session['role'] = role
            session['username'] = username
            session['permissions'] = custom_perms

    perms = sorted(set(ROLE_PERMISSIONS.get(role, []) + list(custom_perms)))
    cfg = _load_global_config()
    return jsonify({
        'logged_in': logged_in,
        'role': role,
        'username': username,
        'permissions': perms,
        'hidden_features': cfg.get('hidden_features', []) if role != 'admin' else [],
        'company_name': cfg.get('company_name', 'LTS Logistik GmbH'),
    })


@bp.route('/api/auth/change-password', methods=['POST'])
@login_required
def api_change_own_password():
    """Change the password of the logged-in account (current password required)."""
    data = request.get_json(silent=True) or {}
    current = str(data.get('current_password', ''))
    new = str(data.get('new_password', ''))
    user = get_user_by_id(int(session.get('user_id') or 0))
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    if not _verify_password(current, user['password_hash']):
        return jsonify({'error': 'Current password is wrong'}), 400
    if len(new) < MIN_PASSWORD_LENGTH:
        return jsonify({'error': f'Password must have at least {MIN_PASSWORD_LENGTH} characters'}), 400
    update_user(user['id'], password=new)
    _log_activity('change_password', 'own account')
    return jsonify({'ok': True})
