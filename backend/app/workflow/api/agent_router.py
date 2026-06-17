# =============================================================================
# workflow/api/agent_router.py — LangGraph ReAct agent HTTP router
#
# Exposes the standalone agentic runner as a fire-and-poll REST API. The agent
# is async and can take tens of seconds to complete, so it runs as a FastAPI
# background task and results are polled by the frontend.
#
# Endpoints:
#   POST /api/agent/runs/       → start a new run; returns 202 immediately
#   GET  /api/agent/runs/       → list recent runs (newest first, default 20)
#   GET  /api/agent/runs/{id}   → get one run with all its steps
#
# Run lifecycle (start a run):
#   1. Create an AgentRun row with status="pending".
#   2. Return the (empty) row immediately as 202 Accepted.
#   3. FastAPI schedules _execute_agent(run_id, query) as a background task.
#
# _execute_agent(run_id, query)
#   The async background task. Opens its own DB session (cannot share the
#   request session across background tasks). Calls agentic_runner.run_agent()
#   which returns the full result dict after the LangGraph graph completes.
#   Then persists:
#     - Updates AgentRun.status, .final_answer, .error, .completed_at.
#     - Creates one AgentStep row per tool call with tool_name, tool_input,
#       tool_output, and status (success | failed).
#
# _serialize(run) → AgentRunOut
#   Converts an AgentRun ORM row (with its steps relationship loaded) into
#   the AgentRunOut Pydantic model for JSON serialization.
#
# Polling pattern (used by the frontend):
#   POST /api/agent/runs/ → receive {id, status: "pending"}
#   poll GET /api/agent/runs/{id} until status is "success" or "failed"
#   Display final_answer and the list of steps (tool name + input + output).
# =============================================================================
import uuid
from datetime import datetime, UTC
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.workflow.agent.agent_db import AgentRun, AgentStep
from app.workflow.agent.agentic_runner import run_agent

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class AgentRunRequest(BaseModel):
    query: str = Field(min_length=5, max_length=2000)


class AgentStepOut(BaseModel):
    step_index:  int
    tool_name:   str
    tool_input:  dict | None
    tool_output: dict | None
    status:      str
    created_at:  datetime


class AgentRunOut(BaseModel):
    id:           str
    query:        str
    status:       str
    final_answer: str | None
    error:        str | None
    started_at:   datetime
    completed_at: datetime | None
    steps:        list[AgentStepOut]


# ── Background worker ─────────────────────────────────────────────────────────

async def _execute_agent(run_id: str, query: str) -> None:
    """Async background task: runs the agent and persists all results."""
    db = SessionLocal()
    run: AgentRun | None = None
    try:
        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if not run:
            return

        run.status = "running"
        db.commit()

        result = await run_agent(query, run_id)

        run.status       = result["status"]
        run.final_answer = result.get("final_answer")
        run.error        = result.get("error")
        run.completed_at = datetime.now(UTC)

        for step_data in result.get("steps", []):
            db.add(AgentStep(
                id          = str(uuid.uuid4()),
                run_id      = run_id,
                step_index  = step_data["step_index"],
                tool_name   = step_data["tool_name"],
                tool_input  = step_data.get("tool_input"),
                tool_output = step_data.get("tool_output"),
                status      = step_data.get("status", "success"),
            ))

        db.commit()
    except Exception as exc:
        try:
            if run is not None:
                run.status = "failed"
                run.error  = str(exc)
                run.completed_at = datetime.now(UTC)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(run: AgentRun) -> AgentRunOut:
    return AgentRunOut(
        id           = run.id,
        query        = run.query,
        status       = run.status,
        final_answer = run.final_answer,
        error        = run.error,
        started_at   = run.started_at,
        completed_at = run.completed_at,
        steps=[
            AgentStepOut(
                step_index  = s.step_index,
                tool_name   = s.tool_name,
                tool_input  = s.tool_input,
                tool_output = s.tool_output,
                status      = s.status,
                created_at  = s.created_at,
            )
            for s in run.steps
        ],
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", response_model=AgentRunOut, status_code=202)
async def start_agent_run(
    req: AgentRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Start a new agentic run. Returns immediately (202); poll GET /{id} for results."""
    run = AgentRun(
        id         = str(uuid.uuid4()),
        query      = req.query,
        status     = "pending",
        started_at = datetime.now(UTC),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    background_tasks.add_task(_execute_agent, run.id, req.query)

    return _serialize(run)


@router.get("/", response_model=list[AgentRunOut])
def list_agent_runs(limit: int = 20, db: Session = Depends(get_db)):
    """List recent agent runs, newest first."""
    runs = (
        db.query(AgentRun)
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize(r) for r in runs]


@router.get("/{run_id}", response_model=AgentRunOut)
def get_agent_run(run_id: str, db: Session = Depends(get_db)):
    """Get a single agent run with all its steps."""
    run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return _serialize(run)
