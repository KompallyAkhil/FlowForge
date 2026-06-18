# =============================================================================
# main.py — FastAPI application factory and entry point
#
# This is the root of the entire backend. It does four things:
#
# 1. Creates the FastAPI app with CORS middleware so the Next.js frontend
#    (localhost:3000) can talk to the backend (localhost:8000).
#
# 2. Registers all API routers under their URL prefixes:
#    - /api/chat        → Aiden general-purpose chat assistant
#    - /api/memory      → In-memory session-scoped key-value store
#    - /api/integrations → Google OAuth + Slack token management
#    - /api/workflows   → Workflow CRUD, review, approval, scheduling
#    - /api/executions  → Execution status, logs, resume, chat
#    - /api/agent/runs  → LangGraph ReAct agent (free-form tool use)
#
# 3. Runs startup logic via the lifespan context manager:
#    - init_db()                → creates all SQLite tables (no Alembic)
#    - _reset_stuck_executions() → marks orphaned "running" rows as failed
#    - start_scheduler()        → starts the APScheduler background thread
#    - load_scheduled_workflows() → re-registers cron jobs from the DB so
#                                   schedules survive server restarts
#
# 4. Exposes GET /health as a simple liveness probe.
#
# Importing `app.workflow.integrations` (noqa line) triggers the integration
# registry to load all adapters (gmail, slack, sheets, ai, generic) so they
# are available before any request is handled.
# =============================================================================
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.api import chat, memory, integrations
from app.workflow.api import workflow_router, execution_router, agent_router
import app.workflow.integrations  # noqa: F401 — registers all integrations on import

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from app.database import init_db
    from app.scheduler import start_scheduler, stop_scheduler, load_scheduled_workflows
    from app.workflow.engine.execution_engine import set_event_loop
    set_event_loop(asyncio.get_event_loop())
    init_db()
    _reset_stuck_executions()
    start_scheduler()
    load_scheduled_workflows()  # re-register any schedule-enabled workflows from DB
    yield
    stop_scheduler()


def _reset_stuck_executions() -> None:
    """On startup, mark any 'running' executions as failed.

    These are left over from a previous process that was killed mid-run.
    Without this, the UI shows them as running forever.
    """
    import logging
    from datetime import datetime, UTC
    from app.database import SessionLocal
    from app.workflow.db_models import Execution

    logger = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        stuck = db.query(Execution).filter(Execution.status == "running").all()
        for ex in stuck:
            ex.status = "failed"
            ex.error = "Execution was interrupted (server restarted while this was running)"
            ex.completed_at = ex.completed_at or datetime.now(UTC)
        if stuck:
            db.commit()
            logger.warning("Startup: reset %d stuck execution(s) to 'failed'", len(stuck))
    finally:
        db.close()


app = FastAPI(
    title="FlowForge — Workflow Automation Platform",
    description="AI-powered workflow automation with Gmail, Slack, Google Sheets, and LangGraph agents.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chat assistant
app.include_router(chat.router,         prefix="/api/chat",         tags=["chat"])
app.include_router(memory.router,       prefix="/api/memory",       tags=["memory"])
app.include_router(integrations.router, prefix="/api/integrations", tags=["integrations"])

# Workflow engine
app.include_router(workflow_router.router,  prefix="/api/workflows",  tags=["workflows"])
app.include_router(execution_router.router, prefix="/api/executions", tags=["executions"])

# LangGraph agentic runner
app.include_router(agent_router.router, prefix="/api/agent/runs", tags=["agent"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "FlowForge", "version": "1.0.0"}
