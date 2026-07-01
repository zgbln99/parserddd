"""
Centralized configuration for DDD Reader backend.

All environment variables and defaults are defined here.
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
# Paths and credentials
# ---------------------------------------------------------------------------

DDDPARSER_PATH = os.environ.get('DDDPARSER_PATH', 'dddparser')
TACHOGRAPH_GO_PATH = os.environ.get(
    'TACHOGRAPH_GO_PATH',
    os.path.join(os.path.dirname(__file__), 'tachograph'),
)
PORTAL_PASSWORD = os.environ.get('PORTAL_PASSWORD', 'lts2025')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Marek2211.!')
LOGIN_HISTORY_FILE = os.environ.get('LOGIN_HISTORY_FILE', '/opt/ddd-reader/login_history.json')
USERS_FILE = os.environ.get('USERS_FILE', '/opt/ddd-reader/users.json')
ACTIVITY_LOG_FILE = os.environ.get('ACTIVITY_LOG_FILE', '/opt/ddd-reader/activity_log.json')
CONFIG_FILE = os.environ.get('CONFIG_FILE', '/opt/ddd-reader/config.json')
DATABASE_FILE = os.environ.get('DATABASE_FILE', '/opt/ddd-reader/ddd_portal.db')

# ---------------------------------------------------------------------------
# External services
# ---------------------------------------------------------------------------

# Legacy Dropbox config — kept only so older code/imports don't break;
# the app now stores files in MEGA S4 (S3-compatible), see below.
DROPBOX_APP_KEY = os.environ.get('DROPBOX_APP_KEY', '')
DROPBOX_APP_SECRET = os.environ.get('DROPBOX_APP_SECRET', '')
DROPBOX_REFRESH_TOKEN = os.environ.get('DROPBOX_REFRESH_TOKEN', '')
SAMSARA_API_TOKEN = os.environ.get('SAMSARA_API_TOKEN', '')
SAMSARA_API_BASE = 'https://api.eu.samsara.com'

# ---------------------------------------------------------------------------
# Object storage (MEGA S4 / S3-compatible) — replaces Dropbox.
# Credentials come from the environment only; never hard-code keys. The
# bucket stays private; files are streamed through the backend, never via
# public URLs.
# ---------------------------------------------------------------------------

MEGA_S4_ACCESS_KEY_ID = os.environ.get('MEGA_S4_ACCESS_KEY_ID', '')
MEGA_S4_SECRET_ACCESS_KEY = os.environ.get('MEGA_S4_SECRET_ACCESS_KEY', '')
MEGA_S4_BUCKET = os.environ.get('MEGA_S4_BUCKET', '')
MEGA_S4_ENDPOINT = os.environ.get('MEGA_S4_ENDPOINT', 'https://s3.g.s4.mega.io')
MEGA_S4_REGION = os.environ.get('MEGA_S4_REGION', 'eu-central-1')

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

PORTAL_CACHE_FILE = os.environ.get('PORTAL_CACHE_FILE', '/opt/ddd-reader/portal_cache.json')
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
# Rate limiting (in-memory)
# ---------------------------------------------------------------------------

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300  # 5 minutes
_login_attempts: dict = {}  # IP -> (count, first_attempt_time)
_login_lock = threading.Lock()
_activity_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Toll Collect
# ---------------------------------------------------------------------------

TOLLCOLLECT_FOLDER = '/TollCollect'
STUNDENZETTEL_FOLDER = '/Stundenzettel'

# ---------------------------------------------------------------------------
# Flask config
# ---------------------------------------------------------------------------


class FlaskConfig:
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16 MB
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    SESSION_COOKIE_SECURE = os.environ.get('FLASK_ENV') == 'production'
    PERMANENT_SESSION_LIFETIME = timedelta(hours=12)
    SECRET_KEY = os.environ.get('FLASK_SECRET_KEY', 'ddd-parser-secret-key-change-me')


# ---------------------------------------------------------------------------
# Warn about default credentials at import time
# ---------------------------------------------------------------------------

_INSECURE_DEFAULTS = {
    'PORTAL_PASSWORD': 'lts2025',
    'ADMIN_PASSWORD': 'Marek2211.!',
    'FLASK_SECRET_KEY': 'ddd-parser-secret-key-change-me',
}
for _env_key, _default_val in _INSECURE_DEFAULTS.items():
    if os.environ.get(_env_key, _default_val) == _default_val:
        logger.warning('%s is using default value — set it via environment variable!', _env_key)


# ---------------------------------------------------------------------------
# Role-based permissions
# ---------------------------------------------------------------------------

ROLE_PERMISSIONS = {
    'admin': [
        'dashboard', 'drivers', 'reader', 'analysis', 'compare', 'settlement',
        'vehicles', 'driver_km', 'toll', 'samsara_km', 'config', 'night_sim',
        'admin', 'sync', 'verstosse', 'export', 'ddd_preview',
    ],
    'dispatcher': [
        'dashboard', 'drivers', 'reader', 'analysis', 'compare', 'settlement',
        'vehicles', 'driver_km', 'toll', 'samsara_km', 'verstosse', 'export',
        'ddd_preview', 'sync',
    ],
    'user': [
        'dashboard', 'drivers', 'reader', 'analysis', 'sync', 'verstosse',
        'ddd_preview',
    ],
    'driver': [
        'dashboard', 'reader', 'ddd_preview',
    ],
}
