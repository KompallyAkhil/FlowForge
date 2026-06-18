# =============================================================================
# database.py — SQLAlchemy engine, session factory, and schema management
#
# This file is the single source of truth for the database connection. It:
#
# 1. Creates the SQLAlchemy engine pointing at the SQLite file (workflow.db
#    by default, configurable via DATABASE_URL in .env).
#
# 2. Provides SessionLocal — a session factory used by every API endpoint
#    via FastAPI's `Depends(get_db)` pattern (yields a session, closes it
#    after the request regardless of success or failure).
#
# 3. Defines Base (DeclarativeBase) — all ORM models import this to register
#    their table definitions. When init_db() runs, SQLAlchemy creates every
#    table that has been imported and registered.
#
# 4. init_db() — called once on startup in main.py lifespan. It imports all
#    ORM model modules (db_models, agent_db) to ensure their classes are
#    registered with Base before calling create_all(). It also calls
#    _migrate_schema() for additive column changes.
#
# 5. _migrate_schema() — a lightweight migration helper that uses SQLite's
#    PRAGMA table_info to detect missing columns and issues ALTER TABLE ADD
#    COLUMN statements for each. This replaces Alembic entirely. Only use
#    this for adding new nullable or default-valued columns; it cannot rename
#    or drop columns (SQLite doesn't support those operations natively).
#
# Key design constraint: SQLite's "check_same_thread": False is required
# because FastAPI uses a thread pool for sync endpoints and the engine may
# be accessed from multiple threads.
# =============================================================================
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import get_settings

_settings = get_settings()
engine = create_engine(
    _settings.database_url,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.workflow import db_models          # noqa: F401
    from app.workflow.agent import agent_db     # noqa: F401 — registers AgentRun + AgentStep
    Base.metadata.create_all(bind=engine)
    _migrate_schema()


def _migrate_schema() -> None:
    """Add new columns to existing tables without Alembic."""
    with engine.connect() as conn:
        # workflows table
        _add_column_if_missing(conn, "workflows", "explanation",       "TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "workflows", "schedule_enabled",  "BOOLEAN NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "workflows", "schedule_timezone", "VARCHAR NOT NULL DEFAULT 'UTC'")
        _add_column_if_missing(conn, "workflows", "status",            "VARCHAR NOT NULL DEFAULT 'draft'")
        # workflow_versions table (added after initial deploy)
        _add_column_if_missing(conn, "workflow_versions", "name",           "VARCHAR NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "workflow_versions", "change_summary", "TEXT NOT NULL DEFAULT 'Initial creation'")
        _add_column_if_missing(conn, "workflow_versions", "changed_fields", "JSON")
        # executions table — pending_input added for human-in-the-loop pauses
        _add_column_if_missing(conn, "executions", "pending_input", "JSON")
        # execution_logs table
        _add_column_if_missing(conn, "execution_logs", "updated_at",    "DATETIME")
        conn.commit()


def _add_column_if_missing(conn, table: str, column: str, col_def: str) -> None:
    result = conn.execute(text(f"PRAGMA table_info({table})"))
    existing = {row[1] for row in result}
    if column not in existing:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"))
