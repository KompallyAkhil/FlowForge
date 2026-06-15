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
        _add_column_if_missing(conn, "workflows", "schedule_enabled",  "BOOLEAN NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "workflows", "schedule_timezone", "VARCHAR NOT NULL DEFAULT 'UTC'")
        _add_column_if_missing(conn, "workflows", "status",            "VARCHAR NOT NULL DEFAULT 'draft'")
        _add_column_if_missing(conn, "execution_logs", "updated_at",   "DATETIME")
        conn.commit()


def _add_column_if_missing(conn, table: str, column: str, col_def: str) -> None:
    result = conn.execute(text(f"PRAGMA table_info({table})"))
    existing = {row[1] for row in result}
    if column not in existing:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"))
