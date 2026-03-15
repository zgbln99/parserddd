# Route modules for DDD Reader backend
#
# The backend has been structured into logical modules:
# - auth.py: Authentication (login, logout, status, rate limiting)
# - admin.py: Admin panel (users, config, passwords, logs)
# - drivers.py: Driver management and file analysis
# - export.py: CSV, PDF, DATEV exports
# - vehicles.py: Samsara vehicle controlling
#
# Currently imported from the main app.py monolith.
# To fully modularize, convert each section to a Flask Blueprint.
