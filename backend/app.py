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
        """Serve React static build. Falls back to index.html for SPA routing."""
        abs_frontend = os.path.abspath(FRONTEND_DIR)
        if path and os.path.isfile(os.path.join(abs_frontend, path)):
            return send_from_directory(abs_frontend, path)
        index_path = os.path.join(abs_frontend, 'index.html')
        if os.path.isfile(index_path):
            return send_from_directory(abs_frontend, 'index.html')
        return jsonify({'error': 'Frontend not built. Run: cd frontend && npm run build'}), 404

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

    conn.commit()
    conn.close()
    logger.info('Database initialized: %s', DATABASE_FILE)


# ---------------------------------------------------------------------------
# Module-level app instance for gunicorn (app:app) and __main__
# ---------------------------------------------------------------------------

app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8000)
