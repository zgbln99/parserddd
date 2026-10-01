"""
DDD Reader – Flask Application Factory.

Creates and configures the Flask app, registers extensions,
initializes the database, and registers all Blueprints.

Gunicorn entry point:  gunicorn app:app
"""

import os
import secrets
from datetime import datetime

from flask import Flask, jsonify, send_from_directory

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from config import FlaskConfig, FRONTEND_DIR, IS_PRODUCTION, logger
from extensions import init_extensions
from core.constants import UTC
from auth.helpers import apply_persisted_config, import_legacy_json_stores, bootstrap_admin
import database


def create_app() -> Flask:
    """Application factory — creates and configures the Flask app."""
    application = Flask(__name__, static_folder=None)
    application.config.from_object(FlaskConfig)

    # ---------------------------------------------------------------------------
    # Session secret — never a built-in default
    # ---------------------------------------------------------------------------
    if not application.config.get('SECRET_KEY'):
        if IS_PRODUCTION:
            raise RuntimeError(
                'FLASK_SECRET_KEY is not set. Generate one with `openssl rand -hex 32` '
                'and put it in .env before running in production.'
            )
        application.config['SECRET_KEY'] = secrets.token_hex(32)
        logger.warning('FLASK_SECRET_KEY not set — using a random per-process key; '
                       'sessions will not survive a restart.')

    # ---------------------------------------------------------------------------
    # Extensions (CORS, rate limiter)
    # ---------------------------------------------------------------------------
    init_extensions(application)

    # ---------------------------------------------------------------------------
    # Database: schema + migrations, then one-time import of the old JSON
    # stores and the first admin account.
    # ---------------------------------------------------------------------------
    database.init_db()
    logger.info('Database ready (%s)', database.get_engine())
    import_legacy_json_stores()
    bootstrap_admin()
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
        uptime = (datetime.now(UTC) - _app_start_time).total_seconds()
        db_ok = False
        try:
            with database.get_db() as db:
                db.query_one('SELECT 1 AS ok')
            db_ok = True
        except Exception:
            logger.exception('health check: database unavailable')
        return jsonify({
            'status': 'ok' if db_ok else 'degraded',
            'uptime_seconds': int(uptime),
            'database': db_ok,
            'engine': database.get_engine(),
        })

    # ---------------------------------------------------------------------------
    # Serve frontend (SPA fallback)
    # ---------------------------------------------------------------------------
    @application.route('/', defaults={'path': ''})
    @application.route('/<path:path>')
    def serve_frontend(path):
        """Serve React static build. Falls back to index.html for SPA routing.

        Never serve `index.html` for `/api/*` requests: an unregistered
        blueprint must surface as a JSON 404, not as HTML the frontend then
        tries to JSON.parse.
        """
        if path.startswith('api/'):
            return jsonify({'error': 'Endpoint not found', 'path': '/' + path}), 404

        abs_frontend = os.path.abspath(FRONTEND_DIR)
        if path and os.path.isfile(os.path.join(abs_frontend, path)):
            return send_from_directory(abs_frontend, path)
        # Files dropped into `frontend/public/` serve without a rebuild; Vite
        # copies public/ into dist/ anyway, so prod stays correct.
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
    # JSON error handlers for /api/* — never leak exception details
    # ---------------------------------------------------------------------------
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
            # Full traceback goes to the server log; the client only learns
            # that something failed.
            logger.exception('Unhandled error in %s', _request.path)
            return jsonify({'error': 'Internal server error'}), 500
        raise exc

    return application


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
    _hash_password, _verify_password, _load_users,
    _check_rate_limit, _record_failed_login, _clear_rate_limit,
    _record_login, _log_activity, _log_config_change,
    _load_config, _save_config, apply_persisted_config,
)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8000)
