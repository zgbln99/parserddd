"""
Database abstraction layer — supports both SQLite and PostgreSQL.

Set DATABASE_URL env var to use PostgreSQL:
  DATABASE_URL=postgresql://user:pass@host:5432/dbname

Falls back to SQLite via DATABASE_FILE env var (default behavior).
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
    """Get a thread-local SQLite connection."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


class DbRow(dict):
    """Dict subclass that also supports attribute access like sqlite3.Row."""
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)


@contextmanager
def get_db():
    """Context manager yielding a DB connection wrapper.

    Usage:
        with get_db() as db:
            rows = db.query("SELECT * FROM driver_config WHERE card_number = %s", (cn,))
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
        sql = self._adapt_sql(sql)
        cur = self._conn.cursor()
        cur.execute(sql, params or ())
        return cur

    def executescript(self, sql: str):
        """Execute a multi-statement SQL script."""
        sql = self._adapt_sql(sql)
        if self.engine == 'postgresql':
            cur = self._conn.cursor()
            cur.execute(sql)
            return cur
        else:
            self._conn.executescript(sql)

    def query(self, sql: str, params=None) -> list:
        """Execute SELECT and return list of DbRow dicts."""
        sql = self._adapt_sql(sql)
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

    def _adapt_sql(self, sql: str) -> str:
        """Convert SQLite-style ? placeholders to %s for PostgreSQL."""
        if self.engine == 'postgresql':
            sql = sql.replace('?', '%s')
            sql = sql.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'SERIAL PRIMARY KEY')
            sql = sql.replace('PRAGMA journal_mode=WAL', '')
            sql = sql.replace('PRAGMA foreign_keys=ON', '')
        return sql


# ---------------------------------------------------------------------------
# Schema initialization
# ---------------------------------------------------------------------------

def init_db():
    """Create all tables if they don't exist."""
    engine = get_engine()

    if engine == 'sqlite':
        os.makedirs(os.path.dirname(DATABASE_FILE), exist_ok=True)

    with get_db() as db:
        # driver_config
        db.executescript('''
            CREATE TABLE IF NOT EXISTS driver_config (
                id            {} PRIMARY KEY {},
                card_number   TEXT UNIQUE NOT NULL,
                driver_name   TEXT NOT NULL DEFAULT '',
                personal_nr   TEXT NOT NULL DEFAULT '',
                double_diet   INTEGER NOT NULL DEFAULT 0,
                diet_rate     REAL NOT NULL DEFAULT 14.0,
                notes         TEXT NOT NULL DEFAULT '',
                card_expiry_date TEXT NOT NULL DEFAULT '',
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            );
        '''.format(
            'SERIAL' if engine == 'postgresql' else 'INTEGER',
            '' if engine == 'postgresql' else 'AUTOINCREMENT',
        ))

        # driver_monthly_days
        db.executescript('''
            CREATE TABLE IF NOT EXISTS driver_monthly_days (
                id            {} PRIMARY KEY {},
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
        '''.format(
            'SERIAL' if engine == 'postgresql' else 'INTEGER',
            '' if engine == 'postgresql' else 'AUTOINCREMENT',
        ))

        # config_audit_log
        db.executescript('''
            CREATE TABLE IF NOT EXISTS config_audit_log (
                id            {} PRIMARY KEY {},
                card_number   TEXT NOT NULL DEFAULT '',
                driver_name   TEXT NOT NULL DEFAULT '',
                action        TEXT NOT NULL,
                field_name    TEXT NOT NULL DEFAULT '',
                old_value     TEXT NOT NULL DEFAULT '',
                new_value     TEXT NOT NULL DEFAULT '',
                changed_by    TEXT NOT NULL DEFAULT 'admin',
                changed_at    TEXT NOT NULL
            );
        '''.format(
            'SERIAL' if engine == 'postgresql' else 'INTEGER',
            '' if engine == 'postgresql' else 'AUTOINCREMENT',
        ))

        # users table (new — for roles & permissions)
        db.executescript('''
            CREATE TABLE IF NOT EXISTS app_users (
                id            {} PRIMARY KEY {},
                name          TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'user',
                permissions   TEXT NOT NULL DEFAULT '[]',
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            );
        '''.format(
            'SERIAL' if engine == 'postgresql' else 'INTEGER',
            '' if engine == 'postgresql' else 'AUTOINCREMENT',
        ))

        db.commit()

    # SQLite-specific migrations (add columns if missing)
    if engine == 'sqlite':
        _run_sqlite_migrations()


def _run_sqlite_migrations():
    """Run ALTER TABLE migrations for SQLite (idempotent)."""
    with get_db() as db:
        # card_expiry_date on driver_config
        try:
            db.execute("SELECT card_expiry_date FROM driver_config LIMIT 1")
        except Exception:
            db.execute("ALTER TABLE driver_config ADD COLUMN card_expiry_date TEXT NOT NULL DEFAULT ''")
            db.commit()
        # absence_days on driver_monthly_days
        try:
            db.execute("SELECT absence_days FROM driver_monthly_days LIMIT 1")
        except Exception:
            db.execute("ALTER TABLE driver_monthly_days ADD COLUMN absence_days TEXT NOT NULL DEFAULT '{}'")
            db.commit()
        # override_n25/n40 on driver_monthly_days (admin night hour overrides)
        try:
            db.execute("SELECT override_n25 FROM driver_monthly_days LIMIT 1")
        except Exception:
            db.execute("ALTER TABLE driver_monthly_days ADD COLUMN override_n25 TEXT NOT NULL DEFAULT ''")
            db.execute("ALTER TABLE driver_monthly_days ADD COLUMN override_n40 TEXT NOT NULL DEFAULT ''")
            db.commit()
        try:
            db.execute("SELECT night_40_enabled FROM driver_config LIMIT 1")
        except Exception:
            db.execute("ALTER TABLE driver_config ADD COLUMN night_40_enabled INTEGER NOT NULL DEFAULT 1")
            db.commit()
        # pause_cap_enabled on driver_config (cap break at 45min when driving < 4.5h)
        try:
            db.execute("SELECT pause_cap_enabled FROM driver_config LIMIT 1")
        except Exception:
            db.execute("ALTER TABLE driver_config ADD COLUMN pause_cap_enabled INTEGER NOT NULL DEFAULT 0")
            db.commit()


# ---------------------------------------------------------------------------
# Migration script: SQLite → PostgreSQL
# ---------------------------------------------------------------------------

def migrate_sqlite_to_postgresql():
    """One-time migration: copy all data from SQLite to PostgreSQL.

    Run with: python -c "from database import migrate_sqlite_to_postgresql; migrate_sqlite_to_postgresql()"
    Requires DATABASE_URL and DATABASE_FILE to be set.
    """
    if not _HAS_PSYCOPG2:
        print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
        return

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        return

    # Ensure PG tables exist
    init_db()

    # Open SQLite source
    sqlite_conn = sqlite3.connect(DATABASE_FILE)
    sqlite_conn.row_factory = sqlite3.Row

    tables = ['driver_config', 'driver_monthly_days', 'config_audit_log']

    pg_conn = _get_pg_connection()
    try:
        pg_cur = pg_conn.cursor()

        for table in tables:
            # Get all rows from SQLite
            rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
            if not rows:
                print(f"  {table}: 0 rows (skipped)")
                continue

            cols = rows[0].keys()
            # Skip 'id' column — let PostgreSQL auto-generate
            data_cols = [c for c in cols if c != 'id']
            placeholders = ', '.join(['%s'] * len(data_cols))
            col_names = ', '.join(data_cols)

            # Truncate target table
            pg_cur.execute(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE")

            # Insert rows
            for row in rows:
                values = tuple(row[c] for c in data_cols)
                pg_cur.execute(
                    f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})",
                    values,
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
