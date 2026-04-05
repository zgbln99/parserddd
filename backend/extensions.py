"""
Flask extensions — initialized without app, bound later via init_app().

This avoids circular imports: blueprints can ``from extensions import limiter``
without importing the app object.
"""

from flask_cors import CORS

try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    _HAS_LIMITER = True
except ImportError:
    _HAS_LIMITER = False

# ---------------------------------------------------------------------------
# Limiter (created lazily in init_extensions)
# ---------------------------------------------------------------------------

limiter = None
auth_limit = None
data_limit = None


def _noop_decorator(*args, **kwargs):
    """Passthrough decorator used when flask-limiter is not installed."""
    if len(args) == 1 and callable(args[0]):
        return args[0]

    def wrapper(f):
        return f
    return wrapper


def init_extensions(app):
    """Bind extensions to the Flask app instance."""
    global limiter, auth_limit, data_limit

    # CORS
    CORS(app, supports_credentials=True, origins=[
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://dd.ltslog.de',
    ])

    # Rate limiter
    if _HAS_LIMITER:
        limiter = Limiter(
            get_remote_address,
            app=app,
            default_limits=["60 per minute"],
            storage_uri="memory://",
        )
        auth_limit = limiter.limit("10 per minute")
        data_limit = limiter.limit("120 per minute")
    else:
        limiter = None
        auth_limit = _noop_decorator
        data_limit = _noop_decorator
