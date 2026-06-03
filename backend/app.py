"""
DDD Reader – Flask Application Factory.

Creates and configures the Flask app, registers extensions,
initializes the database, and registers all Blueprints.

Gunicorn entry point:  gunicorn app:app
"""

import os
from datetime import datetime

from flask import Flask, jsonify, send_from_directory

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from config import FlaskConfig, FRONTEND_DIR, DATABASE_FILE, logger
from extensions import init_extensions
from core.constants import UTC
from auth.helpers import apply_persisted_config


def create_app() -> Flask:
    """Application factory — creates and configures the Flask app."""
    application = Flask(__name__, static_folder=None)
    application.config.from_object(FlaskConfig)

    # ---------------------------------------------------------------------------
    # Extensions (CORS, rate limiter)
    # ---------------------------------------------------------------------------
    init_extensions(application)

    # ---------------------------------------------------------------------------
    # Database init
    # ---------------------------------------------------------------------------
    _init_db()

    # ---------------------------------------------------------------------------
    # Load persisted config overrides (passwords, tokens from config.json)
    # ---------------------------------------------------------------------------
    apply_persisted_config()

    # ---------------------------------------------------------------------------
    # Register Blueprints
    # ---------------------------------------------------------------------------
    from routes import register_blueprints
    register_blueprints(application)

    # ---------------------------------------------------------------------------
    # Health endpoint
    # ---------------------------------------------------------------------------
    _app_start_time = datetime.now(UTC)

    @application.route('/api/health')
    def health():
        import sqlite3
        uptime = (datetime.now(UTC) - _app_start_time).total_seconds()
        db_ok = False
        try:
            conn = sqlite3.connect(DATABASE_FILE)
            conn.execute('SELECT 1')
            conn.close()
            db_ok = True
        except Exception:
            pass
        return jsonify({
            'status': 'ok' if db_ok else 'degraded',
            'uptime_seconds': int(uptime),
            'database': db_ok,
        })

    # ---------------------------------------------------------------------------
    # Serve frontend (SPA fallback)
    # ---------------------------------------------------------------------------
    @application.route('/', defaults={'path': ''})
    @application.route('/<path:path>')
    def serve_frontend(path):
        """Serve React static build. Falls back to index.html for SPA routing.

        Critical guard: never serve `index.html` for `/api/*` requests. If a
        blueprint silently failed to register (import error, etc.) the SPA
        fallback used to mask the bug by returning HTML to JSON callers,
        producing the classic "Unexpected token '<'" parse error on the
        frontend. We now return a JSON 404 for any unhandled `/api/*` path.
        """
        if path.startswith('api/'):
            return jsonify({
                'error': 'Endpoint not found',
                'path': '/' + path,
                'hint': 'Check that the relevant Flask blueprint is registered '
                        'and that the backend has been restarted after changes.',
            }), 404

        abs_frontend = os.path.abspath(FRONTEND_DIR)
        # Primary: serve the file from the production build directory.
        if path and os.path.isfile(os.path.join(abs_frontend, path)):
            return send_from_directory(abs_frontend, path)
        # Fallback: also serve files dropped into `frontend/public/` even
        # without running `npm run build`. This is intentional — drop a JPG
        # into public/ and it serves immediately, no rebuild step. Vite's
        # build copies public/ into dist/ anyway, so prod stays correct.
        public_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public'),
        )
        if path and os.path.isfile(os.path.join(public_dir, path)):
            return send_from_directory(public_dir, path)
        index_path = os.path.join(abs_frontend, 'index.html')
        if os.path.isfile(index_path):
            return send_from_directory(abs_frontend, 'index.html')
        return jsonify({'error': 'Frontend not built. Run: cd frontend && npm run build'}), 404

    # ---------------------------------------------------------------------------
    # JSON error handlers for /api/*
    # ---------------------------------------------------------------------------
    # Keeps the contract: any /api/* response is JSON, never HTML. Handlers
    # below only fire when nothing else caught the exception — they are the
    # safety net for things like uncaught Dropbox SDK errors, subprocess
    # failures, or schema typos in route bodies.
    from werkzeug.exceptions import HTTPException
    from flask import request as _request

    @application.errorhandler(HTTPException)
    def _json_http_error(exc):
        if _request.path.startswith('/api/'):
            return jsonify({
                'error': exc.name,
                'detail': exc.description or '',
                'status': exc.code,
            }), exc.code or 500
        return exc

    @application.errorhandler(Exception)
    def _json_uncaught(exc):
        if _request.path.startswith('/api/'):
            logger.exception('Unhandled error in %s', _request.path)
            return jsonify({
                'error': 'Internal server error',
                'detail': str(exc),
            }), 500
        # Re-raise so non-API requests fall through to Flask's default page.
        raise exc

    return application


def _init_db():
    """Create database tables if they don't exist (SQLite)."""
    import sqlite3
    os.makedirs(os.path.dirname(DATABASE_FILE), exist_ok=True)
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS driver_config (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number   TEXT UNIQUE NOT NULL,
            driver_name   TEXT NOT NULL DEFAULT '',
            personal_nr   TEXT NOT NULL DEFAULT '',
            double_diet   INTEGER NOT NULL DEFAULT 0,
            diet_rate     REAL NOT NULL DEFAULT 14.0,
            notes         TEXT NOT NULL DEFAULT '',
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
    ''')
    try:
        conn.execute("SELECT card_expiry_date FROM driver_config LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_config ADD COLUMN card_expiry_date TEXT NOT NULL DEFAULT ''")
        conn.commit()
    try:
        conn.execute("SELECT night_40_enabled FROM driver_config LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_config ADD COLUMN night_40_enabled INTEGER NOT NULL DEFAULT 1")
        conn.commit()
    try:
        conn.execute("SELECT pause_cap_enabled FROM driver_config LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_config ADD COLUMN pause_cap_enabled INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    # monthly_gross_eur on driver_config — per-driver override of the
    # company-wide assumed monthly gross used by the MiLoG check (0 = use
    # the global default from admin config).
    try:
        conn.execute("SELECT monthly_gross_eur FROM driver_config LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_config ADD COLUMN monthly_gross_eur REAL NOT NULL DEFAULT 0")
        conn.commit()
    # charter_enabled on driver_config — drivers on charter trips get the
    # Mon/Fri 2× diet + Tue–Thu 2× diet + 8 € Übernachtung pattern.
    try:
        conn.execute("SELECT charter_enabled FROM driver_config LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_config ADD COLUMN charter_enabled INTEGER NOT NULL DEFAULT 0")
        conn.commit()

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS driver_monthly_days (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number   TEXT NOT NULL,
            period        TEXT NOT NULL,
            vacation_days REAL NOT NULL DEFAULT 0,
            sick_days     REAL NOT NULL DEFAULT 0,
            overtime_hm   TEXT NOT NULL DEFAULT '',
            notes         TEXT NOT NULL DEFAULT '',
            absence_days  TEXT NOT NULL DEFAULT '{}',
            updated_at    TEXT NOT NULL,
            UNIQUE(card_number, period)
        );
    ''')
    try:
        conn.execute("SELECT absence_days FROM driver_monthly_days LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_monthly_days ADD COLUMN absence_days TEXT NOT NULL DEFAULT '{}'")
        conn.commit()
    try:
        conn.execute("SELECT override_n25 FROM driver_monthly_days LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_monthly_days ADD COLUMN override_n25 TEXT NOT NULL DEFAULT ''")
        conn.execute("ALTER TABLE driver_monthly_days ADD COLUMN override_n40 TEXT NOT NULL DEFAULT ''")
        conn.commit()
    try:
        conn.execute("SELECT override_work_hm FROM driver_monthly_days LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_monthly_days ADD COLUMN override_work_hm TEXT NOT NULL DEFAULT ''")
        conn.commit()

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS config_audit_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number   TEXT NOT NULL DEFAULT '',
            driver_name   TEXT NOT NULL DEFAULT '',
            action        TEXT NOT NULL,
            field_name    TEXT NOT NULL DEFAULT '',
            old_value     TEXT NOT NULL DEFAULT '',
            new_value     TEXT NOT NULL DEFAULT '',
            changed_by    TEXT NOT NULL DEFAULT 'admin',
            changed_at    TEXT NOT NULL
        );
    ''')

    # Activity-based compliance per-violation status. Keyed by the
    # content-addressable violation_id from backend/compliance — same
    # input -> same id across evaluations, so a status sticks even
    # when the dispatcher re-runs the engine.
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS violation_statuses (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            violation_id  TEXT NOT NULL UNIQUE,
            rule_code     TEXT NOT NULL DEFAULT '',
            driver_card   TEXT NOT NULL DEFAULT '',
            status        TEXT NOT NULL DEFAULT 'NEW',
            note          TEXT NOT NULL DEFAULT '',
            signed_token  TEXT NOT NULL DEFAULT '',
            updated_at    TEXT NOT NULL,
            updated_by    TEXT NOT NULL DEFAULT ''
        );
    ''')

    # Driver-signing tokens (one-time public links sent via WhatsApp).
    # Required by /api/admin/sign-links and /api/sign/<token>. CREATE IF
    # NOT EXISTS so the migration is idempotent across restarts.
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS signing_tokens (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            token             TEXT NOT NULL UNIQUE,
            driver_card       TEXT NOT NULL,
            driver_name       TEXT NOT NULL DEFAULT '',
            payload_json      TEXT NOT NULL,
            payload_hash      TEXT NOT NULL,
            locale            TEXT NOT NULL DEFAULT 'de',
            created_by        TEXT NOT NULL DEFAULT 'admin',
            created_at        TEXT NOT NULL,
            expires_at        TEXT NOT NULL,
            used_at           TEXT,
            used_ip           TEXT,
            used_ua           TEXT,
            signature_png     TEXT,
            signer_name       TEXT,
            driver_remark     TEXT,
            pdf_dropbox_path  TEXT,
            status            TEXT NOT NULL DEFAULT 'pending'
        );
    ''')

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS payroll_status (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number   TEXT NOT NULL,
            period        TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT '',
            updated_at    TEXT NOT NULL,
            UNIQUE(card_number, period)
        );
    ''')

    # Public, password-gated driver profiles (stable link + password).
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS driver_profiles (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number   TEXT NOT NULL UNIQUE,
            driver_name   TEXT NOT NULL DEFAULT '',
            token         TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL DEFAULT '',
            enabled       INTEGER NOT NULL DEFAULT 1,
            avatar_key    TEXT NOT NULL DEFAULT '',
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL,
            last_access   TEXT NOT NULL DEFAULT ''
        );
    ''')
    # Migration: add avatar_key to driver_profiles created before avatars.
    try:
        conn.execute("SELECT avatar_key FROM driver_profiles LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE driver_profiles ADD COLUMN avatar_key TEXT NOT NULL DEFAULT ''")
        conn.commit()

    conn.commit()
    conn.close()
    logger.info('Database initialized: %s', DATABASE_FILE)


# ---------------------------------------------------------------------------
# Module-level app instance for gunicorn (app:app) and __main__
# ---------------------------------------------------------------------------

app = create_app()

# ---------------------------------------------------------------------------
# Re-exports for backward compatibility (tests, scripts importing from app)
# ---------------------------------------------------------------------------

# Core constants
from core.constants import REST, AVAILABILITY, WORK, DRIVING, UNKNOWN  # noqa: E402, F401
from core.constants import STRICT_GLOBOFLEET_MODE, ACTIVITY_NAMES  # noqa: E402, F401
from core.constants import _is_rest_like_for_shift_split, _is_break_like_for_reporting  # noqa: E402, F401

# Core utilities
from core.utils import parse_date_safe, minutes_to_hm, minutes_to_decimal  # noqa: E402, F401
from core.utils import _haversine_km, _to_cet, _sanitize_text  # noqa: E402, F401

# Parsers
from core.parsers import parse_ddd_file, parse_ddd_auto  # noqa: E402, F401

# Extractors
from core.extractors import get_driver_info, get_activity_records  # noqa: E402, F401
from core.extractors import get_card_places, get_card_events, get_vehicle_records  # noqa: E402, F401

# Timeline
from core.timeline import build_timeline, merge_intervals, fill_timeline_gaps  # noqa: E402, F401
from core.timeline import _validate_timeline, _merge_cross_day_intervals  # noqa: E402, F401

# Shifts
from core.shifts import detect_shifts, calculate_shift_night_hours  # noqa: E402, F401
from core.shifts import iter_tachograph_minutes, count_bucket_minutes_between  # noqa: E402, F401
from core.shifts import count_minutes_for_interval_from_buckets  # noqa: E402, F401
from core.shifts import split_day_bucket_into_work_blocks  # noqa: E402, F401

# Analysis
from core.analysis import analyze_card  # noqa: E402, F401

# Auth decorators
from auth.decorators import login_required, admin_required, dispatcher_required  # noqa: E402, F401
from auth.decorators import has_permission, permission_required  # noqa: E402, F401

# Auth helpers
from auth.helpers import (  # noqa: E402, F401
    _hash_password, _verify_password, _load_users, _save_users,
    _check_rate_limit, _record_failed_login, _clear_rate_limit,
    _record_login, _log_activity, _log_config_change,
    _load_config, _save_config, apply_persisted_config,
)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8000)
