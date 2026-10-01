"""
Centralized configuration for DDD Reader backend.

All environment variables and defaults are defined here. There are no
built-in passwords or API keys: everything secret comes from the
environment (``.env``) or from the admin panel (stored in the database).
"""

import os
import logging
import threading
from datetime import timedelta

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger('ddd-reader')

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DDDPARSER_PATH = os.environ.get('DDDPARSER_PATH', 'dddparser')
DATA_DIR = os.environ.get('DATA_DIR', '/opt/ddd-reader')
DATABASE_FILE = os.environ.get('DATABASE_FILE', os.path.join(DATA_DIR, 'ddd_portal.db'))

# Legacy JSON stores. They are read ONCE on startup to import existing
# users / logs / settings into the database, then left untouched.
LEGACY_USERS_FILE = os.environ.get('USERS_FILE', os.path.join(DATA_DIR, 'users.json'))
LEGACY_LOGIN_HISTORY_FILE = os.environ.get('LOGIN_HISTORY_FILE', os.path.join(DATA_DIR, 'login_history.json'))
LEGACY_ACTIVITY_LOG_FILE = os.environ.get('ACTIVITY_LOG_FILE', os.path.join(DATA_DIR, 'activity_log.json'))
LEGACY_CONFIG_FILE = os.environ.get('CONFIG_FILE', os.path.join(DATA_DIR, 'config.json'))

# ---------------------------------------------------------------------------
# First-run admin account
# ---------------------------------------------------------------------------
# Used only when the users table is empty: creates the first admin so you
# can log in and add everyone else from the admin panel. Not a shared
# password — once the account exists, these variables are ignored.

ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')

# ---------------------------------------------------------------------------
# External services
# ---------------------------------------------------------------------------

SAMSARA_API_TOKEN = os.environ.get('SAMSARA_API_TOKEN', '')
SAMSARA_API_BASE = 'https://api.eu.samsara.com'

# Object storage (MEGA S4 / S3-compatible). Credentials come from the
# environment only. The bucket stays private; files are streamed through
# the backend, never via public URLs.
MEGA_S4_ACCESS_KEY_ID = os.environ.get('MEGA_S4_ACCESS_KEY_ID', '')
MEGA_S4_SECRET_ACCESS_KEY = os.environ.get('MEGA_S4_SECRET_ACCESS_KEY', '')
MEGA_S4_BUCKET = os.environ.get('MEGA_S4_BUCKET', '')
MEGA_S4_ENDPOINT = os.environ.get('MEGA_S4_ENDPOINT', 'https://s3.g.s4.mega.io')
MEGA_S4_REGION = os.environ.get('MEGA_S4_REGION', 'eu-central-1')

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

PORTAL_CACHE_FILE = os.environ.get('PORTAL_CACHE_FILE', os.path.join(DATA_DIR, 'portal_cache.json'))
PORTAL_CACHE_MAX_AGE = 900  # 15 minutes
VEHICLE_ACTIVITY_CACHE = {}  # key: (period, tuple(vehicle_ids)) -> (timestamp, response_data)
VEHICLE_ACTIVITY_CACHE_TTL = 300  # 5 minutes

# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------

COMPANY_LOGO_PATH = os.environ.get('COMPANY_LOGO_PATH', '')

FRONTEND_DIR = os.environ.get(
    'FRONTEND_DIR',
    os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist'),
)

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

# Failed logins per IP before a 5-minute lockout. Stored in the database so
# the limit holds across every Gunicorn worker.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300
# flask-limiter backend. "memory://" is per-process; point it at Redis
# (redis://host:6379) when you run more than one worker.
RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'memory://')
_activity_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Toll Collect
# ---------------------------------------------------------------------------

TOLLCOLLECT_FOLDER = '/TollCollect'
STUNDENZETTEL_FOLDER = '/Stundenzettel'

# ---------------------------------------------------------------------------
# Flask config
# ---------------------------------------------------------------------------

IS_PRODUCTION = os.environ.get('FLASK_ENV') == 'production'


class FlaskConfig:
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16 MB
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    SESSION_COOKIE_SECURE = IS_PRODUCTION
    PERMANENT_SESSION_LIFETIME = timedelta(hours=12)
    # Empty on purpose: app.create_app() refuses to start in production
    # without FLASK_SECRET_KEY and uses a random per-process key otherwise.
    SECRET_KEY = os.environ.get('FLASK_SECRET_KEY', '')


# ---------------------------------------------------------------------------
# Role-based permissions
# ---------------------------------------------------------------------------

ROLE_PERMISSIONS = {
    'admin': [
        'dashboard', 'drivers', 'reader', 'analysis', 'settlement',
        'vehicles', 'toll', 'config', 'admin', 'sync', 'export', 'ddd_preview',
    ],
    'dispatcher': [
        'dashboard', 'drivers', 'reader', 'analysis', 'settlement',
        'vehicles', 'toll', 'export', 'ddd_preview', 'sync',
    ],
    'user': [
        'dashboard', 'drivers', 'reader', 'analysis', 'sync', 'ddd_preview',
    ],
    'driver': [
        'dashboard', 'reader', 'ddd_preview',
    ],
}

VALID_ROLES = tuple(ROLE_PERMISSIONS.keys())
