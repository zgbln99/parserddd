"""
Blueprint registration.

Each route module exposes a ``bp`` Flask Blueprint.
This function registers them all on the app.

Robustness: we register each blueprint inside its own try/except so that a
single broken module (missing optional dep, syntax error in a fresh file)
does not silently kill ALL routes. Failed registrations are logged with
the exception so the operator can see at startup what's broken — without
that, a missing blueprint just yields HTML 404s from the SPA fallback,
which the frontend then tries to JSON.parse.
"""

import logging

_log = logging.getLogger(__name__)


_BLUEPRINTS = [
    ("auth", "auth"),
    ("drivers", "drivers"),
    ("analysis", "analysis"),
    ("settlement", "settlement"),
    ("export", "export"),
    ("admin", "admin"),
    ("vehicles", "vehicles"),
    ("tollcollect", "tollcollect"),
    ("sync", "sync"),
    ("dashboard", "dashboard"),
    ("stundenzettel", "stundenzettel"),
    ("payroll", "payroll"),
    ("fahrerliste", "fahrerliste"),
    ("status", "status"),
    ("sign", "sign"),
    ("compliance", "compliance"),
    ("legacy", "legacy"),
]


def register_blueprints(app):
    """Import and register all route Blueprints — failures are logged loudly."""
    for module_name, bp_attr_module in _BLUEPRINTS:
        try:
            module = __import__(f"routes.{module_name}", fromlist=["bp"])
            bp = getattr(module, "bp")
        except Exception as exc:
            _log.error(
                "blueprint %s failed to register: %s — endpoints under this "
                "blueprint will return JSON 404 instead of HTML",
                module_name,
                exc,
                exc_info=True,
            )
            continue
        try:
            app.register_blueprint(bp)
        except Exception as exc:
            _log.error("blueprint %s.register_blueprint failed: %s", module_name, exc)
