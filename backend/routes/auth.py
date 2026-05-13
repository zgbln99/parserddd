"""
Auth Blueprint — login, logout, status.
"""

from flask import Blueprint, request, jsonify, session

from auth.decorators import has_permission
from auth.helpers import (
    _check_rate_limit, _record_failed_login, _clear_rate_limit,
    _record_login, _verify_password, _load_users,
)
from auth.helpers import _load_config as _load_global_config
from config import ADMIN_PASSWORD, PORTAL_PASSWORD, ROLE_PERMISSIONS

bp = Blueprint('auth', __name__)


@bp.route('/api/auth/login', methods=['POST'])
def api_login():
    ip = request.remote_addr or '0.0.0.0'
    if _check_rate_limit(ip):
        return jsonify({'error': 'Too many login attempts. Try again in 5 minutes.'}), 429

    data = request.get_json(silent=True) or {}
    password = data.get('password', '')

    if not password or len(password) > 200:
        _record_failed_login(ip)
        return jsonify({'error': 'Nieprawidlowe haslo'}), 401

    if password == ADMIN_PASSWORD:
        session['logged_in'] = True
        session['role'] = 'admin'
        session['username'] = 'admin'
        session['permissions'] = []
        _record_login('admin', 'admin')
        _clear_rate_limit(ip)
        return jsonify({'ok': True, 'role': 'admin', 'username': 'admin', 'permissions': ROLE_PERMISSIONS['admin']})

    if password == PORTAL_PASSWORD:
        session['logged_in'] = True
        session['role'] = 'user'
        session['username'] = 'user'
        session['permissions'] = []
        _record_login('user', 'user')
        _clear_rate_limit(ip)
        return jsonify({'ok': True, 'role': 'user', 'username': 'user', 'permissions': ROLE_PERMISSIONS['user']})

    for u in _load_users():
        if _verify_password(password, u.get('password_hash', '')):
            role = u.get('role', 'user')
            if role not in ROLE_PERMISSIONS:
                role = 'user'
            session['logged_in'] = True
            session['role'] = role
            session['username'] = u.get('name', '')
            custom_perms = u.get('permissions', [])
            session['permissions'] = custom_perms
            _record_login(role, u.get('name', ''))
            _clear_rate_limit(ip)
            perms = list(set(ROLE_PERMISSIONS.get(role, []) + custom_perms))
            return jsonify({'ok': True, 'role': role, 'username': u.get('name', ''), 'permissions': perms})

    _record_failed_login(ip)
    return jsonify({'error': 'Nieprawidlowe haslo'}), 401


@bp.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.pop('logged_in', None)
    session.pop('role', None)
    session.pop('username', None)
    return jsonify({'ok': True})


@bp.route('/api/auth/status')
def api_auth_status():
    role = session.get('role', 'user')
    username = session.get('username', '')
    custom_perms = session.get('permissions', [])

    # Refresh role + permissions from the user record for real (non-portal)
    # logins so admin-side changes take effect on the next status poll —
    # otherwise the user has to log out + back in to see new features.
    # The portal/admin magic logins have no DB row; we keep the session
    # values for those.
    if username and username not in ('user', 'admin'):
        try:
            for u in _load_users():
                if u.get('name') == username:
                    db_role = u.get('role') or role
                    if db_role in ROLE_PERMISSIONS:
                        role = db_role
                    custom_perms = u.get('permissions', []) or []
                    session['role'] = role
                    session['permissions'] = custom_perms
                    break
        except Exception:
            pass

    perms = list(set(ROLE_PERMISSIONS.get(role, []) + custom_perms))
    cfg = _load_global_config()
    return jsonify({
        'logged_in': bool(session.get('logged_in')),
        'role': role,
        'username': username,
        'permissions': perms,
        'hidden_features': cfg.get('hidden_features', []) if role != 'admin' else [],
        'company_name': cfg.get('company_name', 'LTS Logistik GmbH'),
    })
