"""
Database layer — SQLite by default, PostgreSQL when DATABASE_URL is set.

    DATABASE_URL=postgresql://user:pass@host:5432/dbname

Everything that persists lives here: the schema (one definition for both
engines), versioned migrations, and two connection styles:

* ``get_db()`` — context manager yielding a :class:`DbConnection`
  (``query`` / ``query_one`` / ``execute`` / ``commit``).
* ``compat_connection()`` — a sqlite3-like connection (``execute`` returning
  a cursor, ``commit``, ``close``) used by the older route code. Rows support
  both ``row['col']`` and ``row[0]`` on both engines.
"""

import os
import sqlite3
import threading
from contextlib import contextmanager

DATABASE_URL = os.environ.get('DATABASE_URL', '')
DATABASE_FILE = os.environ.get('DATABASE_FILE', '/opt/ddd-reader/ddd_portal.db')

_HAS_PSYCOPG2 = False
try:
    import psycopg2
    import psycopg2.extras
    _HAS_PSYCOPG2 = True
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Engine detection
# ---------------------------------------------------------------------------

def get_engine() -> str:
    """Return 'postgresql' or 'sqlite'."""
    if DATABASE_URL and DATABASE_URL.startswith('postgresql') and _HAS_PSYCOPG2:
        return 'postgresql'
    return 'sqlite'


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

_pg_pool_lock = threading.Lock()
_pg_pool = None


def _get_pg_connection():
    """Get a PostgreSQL connection (simple pooling via psycopg2)."""
    global _pg_pool
    if _pg_pool is None:
        with _pg_pool_lock:
            if _pg_pool is None:
                from psycopg2 import pool
                _pg_pool = pool.ThreadedConnectionPool(1, 10, DATABASE_URL)
    conn = _pg_pool.getconn()
    conn.autocommit = False
    return conn


def _return_pg_connection(conn):
    if _pg_pool:
        _pg_pool.putconn(conn)


def _get_sqlite_connection():
    """Get a SQLite connection (WAL, foreign keys on)."""
    os.makedirs(os.path.dirname(DATABASE_FILE), exist_ok=True)
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


class DbRow(dict):
    """Dict row that also supports attribute access and positional indexing,
    so ``row['x']``, ``row.x`` and ``row[0]`` all work like sqlite3.Row."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return dict.__getitem__(self, key)

    def keys(self):  # sqlite3.Row.keys() returns a list
        return list(dict.keys(self))


def _adapt_sql(sql: str, engine: str) -> str:
    """Convert SQLite-style SQL to PostgreSQL where the dialects differ."""
    if engine == 'postgresql':
        sql = sql.replace('?', '%s')
        sql = sql.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'SERIAL PRIMARY KEY')
        sql = sql.replace('PRAGMA journal_mode=WAL', '')
        sql = sql.replace('PRAGMA foreign_keys=ON', '')
    return sql


@contextmanager
def get_db():
    """Context manager yielding a DB connection wrapper.

    Usage:
        with get_db() as db:
            rows = db.query("SELECT * FROM driver_config WHERE card_number = ?", (cn,))
            db.execute("UPDATE ...", (...))
            db.commit()
    """
    engine = get_engine()
    if engine == 'postgresql':
        raw_conn = _get_pg_connection()
        try:
            yield DbConnection(raw_conn, engine='postgresql')
        finally:
            try:
                raw_conn.rollback()
            except Exception:
                pass
            _return_pg_connection(raw_conn)
    else:
        raw_conn = _get_sqlite_connection()
        try:
            yield DbConnection(raw_conn, engine='sqlite')
        finally:
            raw_conn.close()


class DbConnection:
    """Unified DB wrapper that normalizes SQLite and PostgreSQL differences."""

    def __init__(self, conn, engine: str):
        self._conn = conn
        self.engine = engine

    def execute(self, sql: str, params=None):
        sql = _adapt_sql(sql, self.engine)
        cur = self._conn.cursor()
        cur.execute(sql, params or ())
        return cur

    def executescript(self, sql: str):
        """Execute a multi-statement SQL script."""
        sql = _adapt_sql(sql, self.engine)
        if self.engine == 'postgresql':
            cur = self._conn.cursor()
            cur.execute(sql)
            return cur
        else:
            self._conn.executescript(sql)

    def query(self, sql: str, params=None) -> list:
        """Execute SELECT and return list of DbRow dicts."""
        sql = _adapt_sql(sql, self.engine)
        if self.engine == 'postgresql':
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(sql, params or ())
            return [DbRow(r) for r in cur.fetchall()]
        else:
            cur = self._conn.cursor()
            cur.execute(sql, params or ())
            cols = [desc[0] for desc in cur.description] if cur.description else []
            return [DbRow(zip(cols, row)) for row in cur.fetchall()]

    def query_one(self, sql: str, params=None):
        """Execute SELECT and return first row or None."""
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    @property
    def lastrowid(self):
        """Get last inserted row ID (works differently per engine)."""
        if self.engine == 'postgresql':
            return None  # Use RETURNING clause instead
        return self._conn.cursor().lastrowid


# ---------------------------------------------------------------------------
# sqlite3-compatible connection (used by the older route code)
# ---------------------------------------------------------------------------

class _CompatCursor:
    """Cursor whose rows are DbRow on PostgreSQL (sqlite returns sqlite3.Row)."""

    def __init__(self, cur, engine):
        self._cur = cur
        self._engine = engine

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        return DbRow(row) if self._engine == 'postgresql' else row

    def fetchall(self):
        rows = self._cur.fetchall()
        return [DbRow(r) for r in rows] if self._engine == 'postgresql' else rows

    @property
    def lastrowid(self):
        return self._cur.lastrowid

    @property
    def rowcount(self):
        return self._cur.rowcount

    def __iter__(self):
        return iter(self.fetchall())


class CompatConnection:
    """Looks like a sqlite3 connection, runs on either engine."""

    def __init__(self):
        self.engine = get_engine()
        self._conn = _get_pg_connection() if self.engine == 'postgresql' else _get_sqlite_connection()
        self._closed = False

    def execute(self, sql: str, params=None):
        sql = _adapt_sql(sql, self.engine)
        if self.engine == 'postgresql':
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        else:
            cur = self._conn.cursor()
        cur.execute(sql, params or ())
        return _CompatCursor(cur, self.engine)

    def executescript(self, sql: str):
        sql = _adapt_sql(sql, self.engine)
        if self.engine == 'postgresql':
            self._conn.cursor().execute(sql)
        else:
            self._conn.executescript(sql)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        if self._closed:
            return
        self._closed = True
        if self.engine == 'postgresql':
            try:
                self._conn.rollback()
            except Exception:
                pass
            _return_pg_connection(self._conn)
        else:
            self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()


def compat_connection() -> CompatConnection:
    return CompatConnection()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

# Every CREATE TABLE is written in SQLite dialect; _adapt_sql rewrites the
# auto-increment primary key for PostgreSQL.
_SCHEMA = [
    '''
    CREATE TABLE IF NOT EXISTS driver_config (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number       TEXT UNIQUE NOT NULL,
        driver_name       TEXT NOT NULL DEFAULT '',
        personal_nr       TEXT NOT NULL DEFAULT '',
        double_diet       INTEGER NOT NULL DEFAULT 0,
        diet_rate         REAL NOT NULL DEFAULT 14.0,
        monthly_gross_eur REAL NOT NULL DEFAULT 0,
        charter_enabled   INTEGER NOT NULL DEFAULT 0,
        night_40_enabled  INTEGER NOT NULL DEFAULT 1,
        pause_cap_enabled INTEGER NOT NULL DEFAULT 0,
        notes             TEXT NOT NULL DEFAULT '',
        card_expiry_date  TEXT NOT NULL DEFAULT '',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    )''',
    '''
    CREATE TABLE IF NOT EXISTS driver_monthly_days (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number      TEXT NOT NULL,
        period           TEXT NOT NULL,
        vacation_days    REAL NOT NULL DEFAULT 0,
        sick_days        REAL NOT NULL DEFAULT 0,
        overtime_hm      TEXT NOT NULL DEFAULT '',
        notes            TEXT NOT NULL DEFAULT '',
        absence_days     TEXT NOT NULL DEFAULT '{}',
        override_n25     TEXT NOT NULL DEFAULT '',
        override_n40     TEXT NOT NULL DEFAULT '',
        override_work_hm TEXT NOT NULL DEFAULT '',
        updated_at       TEXT NOT NULL,
        UNIQUE(card_number, period)
    )''',
    '''
    CREATE TABLE IF NOT EXISTS config_audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number TEXT NOT NULL DEFAULT '',
        driver_name TEXT NOT NULL DEFAULT '',
        action      TEXT NOT NULL,
        field_name  TEXT NOT NULL DEFAULT '',
        old_value   TEXT NOT NULL DEFAULT '',
        new_value   TEXT NOT NULL DEFAULT '',
        changed_by  TEXT NOT NULL DEFAULT 'admin',
        changed_at  TEXT NOT NULL
    )''',
    # Application accounts. ``name`` is the login (unique, case-insensitive
    # via lower() lookups); ``permissions`` is a JSON list of extra feature
    # grants on top of the role defaults.
    '''
    CREATE TABLE IF NOT EXISTS app_users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        permissions   TEXT NOT NULL DEFAULT '[]',
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
    )''',
    # Key/value application settings (replaces the old config.json).
    '''
    CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )''',
    '''
    CREATE TABLE IF NOT EXISTS login_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT '',
        username   TEXT NOT NULL DEFAULT '',
        ip         TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT ''
    )''',
    '''
    CREATE TABLE IF NOT EXISTS activity_log (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        role      TEXT NOT NULL DEFAULT '',
        username  TEXT NOT NULL DEFAULT '',
        ip        TEXT NOT NULL DEFAULT '',
        action    TEXT NOT NULL,
        detail    TEXT NOT NULL DEFAULT ''
    )''',
    # Failed-login throttle shared by every Gunicorn worker.
    '''
    CREATE TABLE IF NOT EXISTS login_attempts (
        ip          TEXT PRIMARY KEY,
        count       INTEGER NOT NULL DEFAULT 0,
        first_at    REAL NOT NULL
    )''',
    '''
    CREATE TABLE IF NOT EXISTS signing_tokens (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        token            TEXT NOT NULL UNIQUE,
        driver_card      TEXT NOT NULL,
        driver_name      TEXT NOT NULL DEFAULT '',
        payload_json     TEXT NOT NULL,
        payload_hash     TEXT NOT NULL,
        locale           TEXT NOT NULL DEFAULT 'de',
        created_by       TEXT NOT NULL DEFAULT 'admin',
        created_at       TEXT NOT NULL,
        expires_at       TEXT NOT NULL,
        used_at          TEXT,
        used_ip          TEXT,
        used_ua          TEXT,
        signature_png    TEXT,
        signer_name      TEXT,
        driver_remark    TEXT,
        pdf_dropbox_path TEXT,
        status           TEXT NOT NULL DEFAULT 'pending'
    )''',
    '''
    CREATE TABLE IF NOT EXISTS payroll_status (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number TEXT NOT NULL,
        period      TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT '',
        updated_at  TEXT NOT NULL,
        UNIQUE(card_number, period)
    )''',
    '''
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
    )''',
    '''
    CREATE TABLE IF NOT EXISTS route_shares (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        token         TEXT NOT NULL UNIQUE,
        vehicle_id    TEXT NOT NULL,
        vehicle_name  TEXT NOT NULL DEFAULT '',
        driver_name   TEXT NOT NULL DEFAULT '',
        label         TEXT NOT NULL DEFAULT '',
        hours         INTEGER NOT NULL DEFAULT 24,
        day           TEXT NOT NULL DEFAULT '',
        from_time     TEXT NOT NULL DEFAULT '',
        to_time       TEXT NOT NULL DEFAULT '',
        vehicles_json TEXT NOT NULL DEFAULT '',
        enabled       INTEGER NOT NULL DEFAULT 1,
        created_by    TEXT NOT NULL DEFAULT 'admin',
        created_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL DEFAULT '',
        last_access   TEXT NOT NULL DEFAULT '',
        access_count  INTEGER NOT NULL DEFAULT 0
    )''',
    '''
    CREATE TABLE IF NOT EXISTS vehicle_movement (
        vehicle_id     TEXT PRIMARY KEY,
        vehicle_name   TEXT NOT NULL DEFAULT '',
        last_moving_at TEXT NOT NULL DEFAULT '',
        idle_since     TEXT NOT NULL DEFAULT '',
        updated_at     TEXT NOT NULL DEFAULT ''
    )''',
    '''
    CREATE TABLE IF NOT EXISTS violation_statuses (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        violation_id TEXT NOT NULL UNIQUE,
        rule_code    TEXT NOT NULL DEFAULT '',
        driver_card  TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'NEW',
        note         TEXT NOT NULL DEFAULT '',
        signed_token TEXT NOT NULL DEFAULT '',
        updated_at   TEXT NOT NULL,
        updated_by   TEXT NOT NULL DEFAULT ''
    )''',
    '''
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
    )''',
]

# Versioned migrations for databases created before a column existed.
# Each entry: (version, table, column, column definition). ``CREATE TABLE IF
# NOT EXISTS`` never alters an existing table, so new columns go here and are
# applied exactly once per database (tracked in schema_migrations).
_MIGRATIONS = [
    (1, 'driver_config', 'card_expiry_date', "TEXT NOT NULL DEFAULT ''"),
    (2, 'driver_config', 'night_40_enabled', 'INTEGER NOT NULL DEFAULT 1'),
    (3, 'driver_config', 'pause_cap_enabled', 'INTEGER NOT NULL DEFAULT 0'),
    (4, 'driver_config', 'monthly_gross_eur', 'REAL NOT NULL DEFAULT 0'),
    (5, 'driver_config', 'charter_enabled', 'INTEGER NOT NULL DEFAULT 0'),
    (6, 'driver_monthly_days', 'absence_days', "TEXT NOT NULL DEFAULT '{}'"),
    (7, 'driver_monthly_days', 'override_n25', "TEXT NOT NULL DEFAULT ''"),
    (8, 'driver_monthly_days', 'override_n40', "TEXT NOT NULL DEFAULT ''"),
    (9, 'driver_monthly_days', 'override_work_hm', "TEXT NOT NULL DEFAULT ''"),
    (10, 'driver_profiles', 'avatar_key', "TEXT NOT NULL DEFAULT ''"),
    (11, 'vehicle_movement', 'idle_since', "TEXT NOT NULL DEFAULT ''"),
    (12, 'route_shares', 'from_time', "TEXT NOT NULL DEFAULT ''"),
    (13, 'route_shares', 'to_time', "TEXT NOT NULL DEFAULT ''"),
    (14, 'route_shares', 'vehicles_json', "TEXT NOT NULL DEFAULT ''"),
    (15, 'app_users', 'is_active', 'INTEGER NOT NULL DEFAULT 1'),
]


def _column_exists(db: DbConnection, table: str, column: str) -> bool:
    if db.engine == 'postgresql':
        row = db.query_one(
            "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
            (table, column),
        )
        return row is not None
    cols = db.query(f"PRAGMA table_info({table})")
    return any(c['name'] == column for c in cols)


def init_db():
    """Create all tables and apply pending column migrations (idempotent)."""
    with get_db() as db:
        for ddl in _SCHEMA:
            db.executescript(ddl)
        db.commit()

        applied = {r['version'] for r in db.query('SELECT version FROM schema_migrations')}
        from datetime import datetime, timezone
        for version, table, column, definition in _MIGRATIONS:
            if version in applied:
                continue
            if not _column_exists(db, table, column):
                db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')
            db.execute(
                'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
                (version, datetime.now(timezone.utc).isoformat()),
            )
            db.commit()


# ---------------------------------------------------------------------------
# Migration script: SQLite → PostgreSQL
# ---------------------------------------------------------------------------

_DATA_TABLES = [
    'driver_config', 'driver_monthly_days', 'config_audit_log', 'app_users',
    'app_settings', 'login_history', 'activity_log', 'signing_tokens',
    'payroll_status', 'driver_profiles', 'route_shares', 'vehicle_movement',
    'violation_statuses',
]


def migrate_sqlite_to_postgresql():
    """One-time migration: copy all data from SQLite to PostgreSQL.

    Run with:
        python -c "from database import migrate_sqlite_to_postgresql; migrate_sqlite_to_postgresql()"
    Requires DATABASE_URL (target) and DATABASE_FILE (source) to be set.
    """
    if not _HAS_PSYCOPG2:
        print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
        return
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        return

    init_db()  # ensure PG tables exist

    sqlite_conn = sqlite3.connect(DATABASE_FILE)
    sqlite_conn.row_factory = sqlite3.Row
    pg_conn = _get_pg_connection()
    try:
        pg_cur = pg_conn.cursor()
        for table in _DATA_TABLES:
            try:
                rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
            except sqlite3.OperationalError:
                print(f"  {table}: not present in SQLite (skipped)")
                continue
            if not rows:
                print(f"  {table}: 0 rows (skipped)")
                continue
            cols = rows[0].keys()
            data_cols = [c for c in cols if c != 'id']
            placeholders = ', '.join(['%s'] * len(data_cols))
            col_names = ', '.join(data_cols)
            pg_cur.execute(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE")
            for row in rows:
                pg_cur.execute(
                    f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})",
                    tuple(row[c] for c in data_cols),
                )
            print(f"  {table}: {len(rows)} rows migrated")
        pg_conn.commit()
        print("\nMigration complete!")
    except Exception as e:
        pg_conn.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        _return_pg_connection(pg_conn)
        sqlite_conn.close()
