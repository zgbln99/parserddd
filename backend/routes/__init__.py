"""
Blueprint registration.

Each route module exposes a ``bp`` Flask Blueprint.
This function registers them all on the app.
"""


def register_blueprints(app):
    """Import and register all route Blueprints."""
    from .auth import bp as auth_bp
    app.register_blueprint(auth_bp)

    from .drivers import bp as drivers_bp
    app.register_blueprint(drivers_bp)

    from .analysis import bp as analysis_bp
    app.register_blueprint(analysis_bp)

    from .settlement import bp as settlement_bp
    app.register_blueprint(settlement_bp)

    from .export import bp as export_bp
    app.register_blueprint(export_bp)

    from .admin import bp as admin_bp
    app.register_blueprint(admin_bp)

    from .vehicles import bp as vehicles_bp
    app.register_blueprint(vehicles_bp)

    from .tollcollect import bp as tollcollect_bp
    app.register_blueprint(tollcollect_bp)

    from .sync import bp as sync_bp
    app.register_blueprint(sync_bp)

    from .dashboard import bp as dashboard_bp
    app.register_blueprint(dashboard_bp)

    from .stundenzettel import bp as stundenzettel_bp
    app.register_blueprint(stundenzettel_bp)

    from .payroll import bp as payroll_bp
    app.register_blueprint(payroll_bp)

    from .status import bp as status_bp
    app.register_blueprint(status_bp)

    from .legacy import bp as legacy_bp
    app.register_blueprint(legacy_bp)
