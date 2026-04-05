"""
Authentication and authorization decorators.

These are imported by every Blueprint, so they live in a standalone
module to avoid circular dependencies.
"""

from functools import wraps

from flask import session, jsonify

from config import ROLE_PERMISSIONS


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': 'Unauthorized'}), 401
        if session.get('role') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


def dispatcher_required(f):
    """Require admin or dispatcher role."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': 'Unauthorized'}), 401
        if session.get('role') not in ('admin', 'dispatcher'):
            return jsonify({'error': 'Dispatcher access required'}), 403
        return f(*args, **kwargs)
    return decorated


def has_permission(permission: str) -> bool:
    """Check if current session user has the given permission."""
    role = session.get('role', 'user')
    if permission in ROLE_PERMISSIONS.get(role, []):
        return True
    custom_perms = session.get('permissions', [])
    return permission in custom_perms


def permission_required(permission: str):
    """Decorator: require a specific permission."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not session.get('logged_in'):
                return jsonify({'error': 'Unauthorized'}), 401
            if not has_permission(permission):
                return jsonify({'error': f'Permission required: {permission}'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator
