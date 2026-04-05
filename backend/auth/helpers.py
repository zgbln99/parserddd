"""
Authentication helper functions.

Password hashing, user management, rate limiting, activity logging,
and persisted config loading.
"""

import hashlib
import json
import os
import sqlite3
from datetime import datetime

from flask import request, session

from config import (
    DATABASE_FILE, LOGIN_HISTORY_FILE, USERS_FILE, ACTIVITY_LOG_FILE,
    CONFIG_FILE, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS,
    _login_attempts, _login_lock, _activity_lock, logger,
)
from core.constants import UTC

try:
    import bcrypt
    _HAS_BCRYPT = True
except ImportError:
    _HAS_BCRYPT = False


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def _hash_password(password: str) -> str:
    """Hash password with bcrypt if available, fall back to SHA256."""
    if _HAS_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    return hashlib.sha256(password.encode()).hexdigest()


def _verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against stored hash (supports both bcrypt and SHA256)."""
    if _HAS_BCRYPT and stored_hash.startswith('$2'):
        try:
            return bcrypt.checkpw(password.encode(), stored_hash.encode())
        except Exception:
            return False
    return hashlib.sha256(password.encode()).hexdigest() == stored_hash


# ---------------------------------------------------------------------------
# User management (JSON file)
# ---------------------------------------------------------------------------

def _load_users() -> list:
    try:
        if os.path.exists(USERS_FILE):
            with open(USERS_FILE) as f:
                return json.load(f)
    except Exception:
        pass
    return []


def _save_users(users: list):
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f, indent=2)


# ---------------------------------------------------------------------------
# Rate limiting (in-memory per IP)
# ---------------------------------------------------------------------------

def _check_rate_limit(ip: str) -> bool:
    """Return True if this IP is rate-limited."""
    now = datetime.now(UTC).timestamp()
    with _login_lock:
        if ip in _login_attempts:
            count, first_time = _login_attempts[ip]
            if now - first_time > LOGIN_WINDOW_SECONDS:
                _login_attempts[ip] = (0, now)
                return False
            if count >= LOGIN_MAX_ATTEMPTS:
                return True
        return False


def _record_failed_login(ip: str):
    now = datetime.now(UTC).timestamp()
    with _login_lock:
        if ip in _login_attempts:
            count, first_time = _login_attempts[ip]
            if now - first_time > LOGIN_WINDOW_SECONDS:
                _login_attempts[ip] = (1, now)
            else:
                _login_attempts[ip] = (count + 1, first_time)
        else:
            _login_attempts[ip] = (1, now)


def _clear_rate_limit(ip: str):
    with _login_lock:
        _login_attempts.pop(ip, None)


# ---------------------------------------------------------------------------
# Login history
# ---------------------------------------------------------------------------

def _record_login(role: str, username: str = ''):
    """Append a login event to the history file."""
    entry = {
        'timestamp': datetime.now(UTC).isoformat(),
        'role': role,
        'username': username or role,
        'ip': request.remote_addr or '',
        'user_agent': request.headers.get('User-Agent', '')[:200],
    }
    try:
        history = []
        if os.path.exists(LOGIN_HISTORY_FILE):
            with open(LOGIN_HISTORY_FILE) as f:
                history = json.load(f)
        history.append(entry)
        history = history[-500:]
        os.makedirs(os.path.dirname(LOGIN_HISTORY_FILE), exist_ok=True)
        with open(LOGIN_HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=2)
    except Exception:
        pass  # non-critical


# ---------------------------------------------------------------------------
# Activity logging
# ---------------------------------------------------------------------------

def _log_activity(action: str, detail: str = ''):
    entry = {
        'timestamp': datetime.now(UTC).isoformat(),
        'role': session.get('role', ''),
        'username': session.get('username', ''),
        'ip': request.remote_addr or '',
        'action': action,
        'detail': detail[:500],
    }
    try:
        with _activity_lock:
            log = []
            if os.path.exists(ACTIVITY_LOG_FILE):
                with open(ACTIVITY_LOG_FILE) as f:
                    log = json.load(f)
            log.append(entry)
            log = log[-1000:]
            os.makedirs(os.path.dirname(ACTIVITY_LOG_FILE), exist_ok=True)
            with open(ACTIVITY_LOG_FILE, 'w') as f:
                json.dump(log, f, indent=2)
    except Exception:
        pass


def _get_db() -> sqlite3.Connection:
    """Get a thread-local SQLite connection (used by auth helpers)."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def _log_config_change(action: str, detail: str = '', card_number: str = '',
                       driver_name: str = '', changes: list = None):
    """Log configuration changes with full context and field-level diffs."""
    _log_activity(f'config_change:{action}', detail)
    if changes:
        now = datetime.now(UTC).isoformat()
        try:
            conn = _get_db()
            for ch in changes:
                conn.execute('''
                    INSERT INTO config_audit_log
                    (card_number, driver_name, action, field_name, old_value, new_value, changed_by, changed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (card_number, driver_name, action, ch.get('field', ''),
                      str(ch.get('old', '')), str(ch.get('new', '')), 'admin', now))
            conn.commit()
            conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Persisted config (JSON file)
# ---------------------------------------------------------------------------

def _load_config() -> dict:
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE) as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_config(cfg: dict):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)


def apply_persisted_config():
    """Load config from JSON file and override env-based defaults in config module."""
    import config as cfg_mod
    data = _load_config()
    if data.get('portal_password'):
        cfg_mod.PORTAL_PASSWORD = data['portal_password']
    if data.get('admin_password'):
        cfg_mod.ADMIN_PASSWORD = data['admin_password']
    if data.get('samsara_api_token'):
        cfg_mod.SAMSARA_API_TOKEN = data['samsara_api_token']
    if data.get('dropbox_refresh_token'):
        cfg_mod.DROPBOX_REFRESH_TOKEN = data['dropbox_refresh_token']
