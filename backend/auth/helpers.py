"""
Authentication helpers.

Accounts, failed-login throttling, login history, the activity log and the
admin settings all live in the database (see ``database.py``). Passwords
are bcrypt hashes — there is no weaker fallback.
"""

import json
import os
from datetime import datetime, timezone

import bcrypt
from flask import request, session

from config import (
    LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, VALID_ROLES, ROLE_PERMISSIONS,
    ADMIN_USERNAME, ADMIN_PASSWORD,
    LEGACY_USERS_FILE, LEGACY_LOGIN_HISTORY_FILE, LEGACY_ACTIVITY_LOG_FILE,
    LEGACY_CONFIG_FILE, _activity_lock, logger,
)
from database import get_db, compat_connection

UTC = timezone.utc


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('ascii')


def _verify_password(password: str, stored_hash: str) -> bool:
    if not password or not stored_hash or not stored_hash.startswith('$2'):
        return False
    try:
        return bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('ascii'))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Users (app_users table)
# ---------------------------------------------------------------------------

def _row_to_user(r) -> dict:
    try:
        perms = json.loads(r['permissions'] or '[]')
    except Exception:
        perms = []
    return {
        'id': r['id'],
        'name': r['name'],
        'password_hash': r['password_hash'],
        'role': r['role'] if r['role'] in VALID_ROLES else 'user',
        'permissions': [p for p in perms if isinstance(p, str)],
        'is_active': bool(r['is_active']),
        'created': r['created_at'],
    }


def _load_users() -> list:
    """All accounts (with password hashes — strip before returning to clients)."""
    with get_db() as db:
        rows = db.query('SELECT * FROM app_users ORDER BY name')
    return [_row_to_user(r) for r in rows]


def count_users() -> int:
    with get_db() as db:
        row = db.query_one('SELECT COUNT(*) AS n FROM app_users')
    return int(row['n']) if row else 0


def get_user_by_name(name: str):
    if not name:
        return None
    with get_db() as db:
        row = db.query_one('SELECT * FROM app_users WHERE lower(name) = lower(?)', (name.strip(),))
    return _row_to_user(row) if row else None


def get_user_by_id(user_id: int):
    with get_db() as db:
        row = db.query_one('SELECT * FROM app_users WHERE id = ?', (user_id,))
    return _row_to_user(row) if row else None


def create_user(name: str, password: str, role: str = 'user', permissions=None) -> int:
    name = name.strip()
    if role not in VALID_ROLES:
        role = 'user'
    known = {p for plist in ROLE_PERMISSIONS.values() for p in plist}
    perms = [str(p) for p in (permissions or []) if str(p) in known]
    now = _now_iso()
    with get_db() as db:
        if db.engine == 'postgresql':
            row = db.query_one(
                'INSERT INTO app_users (name, password_hash, role, permissions, is_active, created_at, updated_at) '
                'VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING id',
                (name, _hash_password(password), role, json.dumps(perms), now, now),
            )
            new_id = int(row['id'])
        else:
            cur = db.execute(
                'INSERT INTO app_users (name, password_hash, role, permissions, is_active, created_at, updated_at) '
                'VALUES (?, ?, ?, ?, 1, ?, ?)',
                (name, _hash_password(password), role, json.dumps(perms), now, now),
            )
            new_id = int(cur.lastrowid)
        db.commit()
    return new_id


def update_user(user_id: int, *, name=None, role=None, permissions=None, password=None, is_active=None) -> list:
    """Update any subset of fields; returns the list of changed field names."""
    sets, params, changed = [], [], []
    if name is not None:
        sets.append('name = ?'); params.append(name.strip()); changed.append('name')
    if role is not None and role in VALID_ROLES:
        sets.append('role = ?'); params.append(role); changed.append('role')
    if permissions is not None:
        known = {p for plist in ROLE_PERMISSIONS.values() for p in plist}
        perms = [str(p) for p in permissions if str(p) in known]
        sets.append('permissions = ?'); params.append(json.dumps(perms)); changed.append('permissions')
    if password:
        sets.append('password_hash = ?'); params.append(_hash_password(password)); changed.append('password')
    if is_active is not None:
        sets.append('is_active = ?'); params.append(1 if is_active else 0); changed.append('is_active')
    if not sets:
        return []
    sets.append('updated_at = ?'); params.append(_now_iso())
    params.append(user_id)
    with get_db() as db:
        db.execute(f"UPDATE app_users SET {', '.join(sets)} WHERE id = ?", tuple(params))
        db.commit()
    return changed


def delete_user(user_id: int) -> bool:
    with get_db() as db:
        cur = db.execute('DELETE FROM app_users WHERE id = ?', (user_id,))
        deleted = cur.rowcount > 0
        db.commit()
    return deleted


def bootstrap_admin():
    """Make sure at least one active admin account exists.

    Runs on every startup but only acts when there is no active admin: it
    then creates ADMIN_USERNAME with ADMIN_PASSWORD (or, if that name is
    already taken, promotes that account and resets its password). Once an
    admin exists the two variables are ignored, so they are not a shared
    password — just the key to the first login.
    """
    with get_db() as db:
        row = db.query_one("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin' AND is_active = 1")
    if row and int(row['n']) > 0:
        return
    if not ADMIN_PASSWORD:
        logger.error(
            'No active admin account exists and ADMIN_PASSWORD is not set — nobody can '
            'manage the system. Set ADMIN_USERNAME / ADMIN_PASSWORD in .env and restart.'
        )
        return
    name = ADMIN_USERNAME or 'admin'
    existing = get_user_by_name(name)
    if existing:
        update_user(existing['id'], role='admin', password=ADMIN_PASSWORD, is_active=True)
        logger.warning('Promoted account %r to admin and reset its password from ADMIN_PASSWORD.', name)
    else:
        create_user(name, ADMIN_PASSWORD, 'admin')
        logger.warning('Created first admin account %r from ADMIN_USERNAME/ADMIN_PASSWORD. '
                       'Change its password in the admin panel.', name)


# ---------------------------------------------------------------------------
# Failed-login throttle (login_attempts table — shared across workers)
# ---------------------------------------------------------------------------

def _check_rate_limit(ip: str) -> bool:
    """Return True if this IP is currently locked out."""
    now = datetime.now(UTC).timestamp()
    with get_db() as db:
        row = db.query_one('SELECT count, first_at FROM login_attempts WHERE ip = ?', (ip,))
        if not row:
            return False
        if now - float(row['first_at']) > LOGIN_WINDOW_SECONDS:
            db.execute('DELETE FROM login_attempts WHERE ip = ?', (ip,))
            db.commit()
            return False
        return int(row['count']) >= LOGIN_MAX_ATTEMPTS


def _record_failed_login(ip: str):
    now = datetime.now(UTC).timestamp()
    with get_db() as db:
        row = db.query_one('SELECT count, first_at FROM login_attempts WHERE ip = ?', (ip,))
        if row and now - float(row['first_at']) <= LOGIN_WINDOW_SECONDS:
            db.execute('UPDATE login_attempts SET count = count + 1 WHERE ip = ?', (ip,))
        else:
            db.execute('DELETE FROM login_attempts WHERE ip = ?', (ip,))
            db.execute('INSERT INTO login_attempts (ip, count, first_at) VALUES (?, 1, ?)', (ip, now))
        db.commit()


def _clear_rate_limit(ip: str):
    with get_db() as db:
        db.execute('DELETE FROM login_attempts WHERE ip = ?', (ip,))
        db.commit()


# ---------------------------------------------------------------------------
# Login history / activity log
# ---------------------------------------------------------------------------

def _record_login(role: str, username: str = ''):
    try:
        with get_db() as db:
            db.execute(
                'INSERT INTO login_history (timestamp, role, username, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
                (_now_iso(), role, username or role, request.remote_addr or '',
                 (request.headers.get('User-Agent', '') or '')[:200]),
            )
            db.commit()
    except Exception:
        logger.exception('login history write failed')


def get_login_history(limit: int = 500) -> list:
    with get_db() as db:
        rows = db.query(
            'SELECT timestamp, role, username, ip, user_agent FROM login_history ORDER BY id DESC LIMIT ?',
            (limit,),
        )
    return [dict(r) for r in rows]


def _log_activity(action: str, detail: str = ''):
    try:
        with _activity_lock, get_db() as db:
            db.execute(
                'INSERT INTO activity_log (timestamp, role, username, ip, action, detail) VALUES (?, ?, ?, ?, ?, ?)',
                (_now_iso(), session.get('role', ''), session.get('username', ''),
                 request.remote_addr or '', action, (detail or '')[:500]),
            )
            db.commit()
    except Exception:
        logger.exception('activity log write failed')


def get_activity_log(limit: int = 1000) -> list:
    with get_db() as db:
        rows = db.query(
            'SELECT timestamp, role, username, ip, action, detail FROM activity_log ORDER BY id DESC LIMIT ?',
            (limit,),
        )
    return [dict(r) for r in rows]


def _get_db():
    """sqlite3-style connection that works on both engines (see database.py)."""
    return compat_connection()


def _log_config_change(action: str, detail: str = '', card_number: str = '',
                       driver_name: str = '', changes: list = None):
    """Log configuration changes with full context and field-level diffs."""
    _log_activity(f'config_change:{action}', detail)
    if changes:
        now = _now_iso()
        try:
            with get_db() as db:
                for ch in changes:
                    db.execute('''
                        INSERT INTO config_audit_log
                        (card_number, driver_name, action, field_name, old_value, new_value, changed_by, changed_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (card_number, driver_name, action, ch.get('field', ''),
                          str(ch.get('old', '')), str(ch.get('new', '')),
                          session.get('username', 'admin') or 'admin', now))
                db.commit()
        except Exception:
            logger.exception('config audit write failed')


# ---------------------------------------------------------------------------
# Persisted settings (app_settings table)
# ---------------------------------------------------------------------------

def _load_config() -> dict:
    try:
        with get_db() as db:
            rows = db.query('SELECT key, value_json FROM app_settings')
        out = {}
        for r in rows:
            try:
                out[r['key']] = json.loads(r['value_json'])
            except Exception:
                pass
        return out
    except Exception:
        logger.exception('settings read failed')
        return {}


def _save_config(cfg: dict):
    now = _now_iso()
    with get_db() as db:
        for key, value in cfg.items():
            db.execute('DELETE FROM app_settings WHERE key = ?', (key,))
            db.execute(
                'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)',
                (key, json.dumps(value), now),
            )
        db.commit()


def apply_persisted_config():
    """Settings saved from the admin panel override env defaults."""
    import config as cfg_mod
    data = _load_config()
    if data.get('samsara_api_token'):
        cfg_mod.SAMSARA_API_TOKEN = data['samsara_api_token']


# ---------------------------------------------------------------------------
# One-time import of the old JSON files
# ---------------------------------------------------------------------------

def _read_json(path):
    try:
        if path and os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        logger.exception('could not read legacy file %s', path)
    return None


def import_legacy_json_stores():
    """Import users.json / login_history.json / activity_log.json / config.json
    into the database. Each store is imported only when its table is empty, so
    this is safe to call on every startup."""
    users = _read_json(LEGACY_USERS_FILE)
    if users and count_users() == 0:
        n = 0
        for u in users:
            name = (u.get('name') or '').strip()
            if not name or not str(u.get('password_hash', '')).startswith('$2'):
                continue  # only bcrypt hashes are carried over
            with get_db() as db:
                if db.query_one('SELECT 1 FROM app_users WHERE lower(name) = lower(?)', (name,)):
                    continue
                db.execute(
                    'INSERT INTO app_users (name, password_hash, role, permissions, is_active, created_at, updated_at) '
                    'VALUES (?, ?, ?, ?, 1, ?, ?)',
                    (name, u['password_hash'], u.get('role') if u.get('role') in VALID_ROLES else 'user',
                     json.dumps([p for p in (u.get('permissions') or []) if isinstance(p, str)]),
                     u.get('created') or _now_iso(), _now_iso()),
                )
                db.commit()
            n += 1
        logger.info('imported %d accounts from %s', n, LEGACY_USERS_FILE)

    with get_db() as db:
        empty_login = db.query_one('SELECT COUNT(*) AS n FROM login_history')['n'] == 0
        empty_activity = db.query_one('SELECT COUNT(*) AS n FROM activity_log')['n'] == 0
        empty_settings = db.query_one('SELECT COUNT(*) AS n FROM app_settings')['n'] == 0

    hist = _read_json(LEGACY_LOGIN_HISTORY_FILE)
    if hist and empty_login:
        with get_db() as db:
            for e in hist[-500:]:
                db.execute(
                    'INSERT INTO login_history (timestamp, role, username, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
                    (e.get('timestamp', ''), e.get('role', ''), e.get('username', ''), e.get('ip', ''), e.get('user_agent', '')),
                )
            db.commit()
        logger.info('imported login history from %s', LEGACY_LOGIN_HISTORY_FILE)

    log = _read_json(LEGACY_ACTIVITY_LOG_FILE)
    if log and empty_activity:
        with get_db() as db:
            for e in log[-1000:]:
                db.execute(
                    'INSERT INTO activity_log (timestamp, role, username, ip, action, detail) VALUES (?, ?, ?, ?, ?, ?)',
                    (e.get('timestamp', ''), e.get('role', ''), e.get('username', ''), e.get('ip', ''),
                     e.get('action', ''), e.get('detail', '')),
                )
            db.commit()
        logger.info('imported activity log from %s', LEGACY_ACTIVITY_LOG_FILE)

    cfg = _read_json(LEGACY_CONFIG_FILE)
    if cfg and empty_settings:
        # The old shared portal/admin passwords are intentionally dropped.
        cfg = {k: v for k, v in cfg.items() if k not in ('portal_password', 'admin_password', 'dropbox_refresh_token')}
        _save_config(cfg)
        logger.info('imported settings from %s', LEGACY_CONFIG_FILE)
