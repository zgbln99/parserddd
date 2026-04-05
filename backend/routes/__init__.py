"""
Blueprint registration.

Each route module exposes a ``bp`` Flask Blueprint.
This function registers them all on the app.
"""


def register_blueprints(app):
    """Import and register all route Blueprints.

    Blueprints are imported inside the function to avoid circular imports
    (they may import from extensions, config, core — but not from app).
    """
    from .drivers import bp as drivers_bp
    app.register_blueprint(drivers_bp)
