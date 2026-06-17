# =============================================================================
# workflow/api/execution_router.py — Execution status, control, and chat router
#
# Handles everything related to a specific execution after it has been started.
# Executions are created by workflow_router.py (approve + execute, or /execute
# directly) and polled here by the frontend's live progress view.
#
# Endpoints:
#   GET  /api/executions/{id}          → execution status + current_step
#   GET  /api/executions/{id}/logs     → per-step logs (input, output, error, retry_count)
#   POST /api/executions/{id}/cancel   → set status=cancelled; background task stops
#                                        at next step boundary, current_step preserved
#   POST /api/executions/{id}/resume   → restart a failed/cancelled execution from
#                                        where it stopped (background task, returns 202)
#   POST /api/executions/{id}/chat     → conversational Q&A about execution results
#
# The /chat endpoint is the most complex. It:
#   1. Loads the execution + its parent workflow and all step logs from DB.
#   2. Builds a steps_summary string (integration.action + description per step).
#   3. Builds a results_summary string (status, output snippet, or error per step).
#      Groups logs by step_index to detect agent-recovered steps (multiple log
#      rows per step where earlier ones failed but the last succeeded).
#   4. Formats both into the EXECUTION_CHAT_SYSTEM prompt template from prompts.py.
#   5. Calls the configured AI provider with the full conversation history
#      (req.history contains prior chat turns from the frontend).
#   6. Returns the AI reply as ExecutionChatResponse.
#
# The polling pattern: the frontend calls GET /{id} + GET /{id}/logs in parallel
# every 1500ms during execution. The logs endpoint is the source of truth for
# step-level progress — the execution row only tracks overall status.
# =============================================================================
import json
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.workflow.schemas import ExecutionResponse, ExecutionLogResponse
from app.workflow.engine import execution_engine
from app.workflow.db_models import Workflow

router = APIRouter()


# ── Execution chat schemas ────────────────────────────────────────────────────

class ChatHistoryMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str

class ExecutionChatRequest(BaseModel):
    message: str
    history: list[ChatHistoryMessage] = []

class ExecutionChatResponse(BaseModel):
    reply: str


@router.get("/{execution_id}", response_model=ExecutionResponse)
def get_execution(execution_id: str, db: Session = Depends(get_db)):
    """Fetch execution status and current step."""
    ex = execution_engine.get_execution(db, execution_id)
    if not ex:
        raise HTTPException(status_code=404, detail="Execution not found")
    return ex


@router.get("/{execution_id}/logs", response_model=list[ExecutionLogResponse])
def get_execution_logs(execution_id: str, db: Session = Depends(get_db)):
    """Fetch all step-level logs for an execution."""
    ex = execution_engine.get_execution(db, execution_id)
    if not ex:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution_engine.get_execution_logs(db, execution_id)


@router.post("/{execution_id}/cancel", response_model=ExecutionResponse)
def cancel_execution(execution_id: str, db: Session = Depends(get_db)):
    """Request cancellation of a running execution.

    Sets status to 'cancelled' immediately. The background task detects this
    at the next step boundary and stops cleanly, preserving current_step so
    the execution can be resumed later.
    """
    ex = execution_engine.get_execution(db, execution_id)
    if not ex:
        raise HTTPException(status_code=404, detail="Execution not found")
    if ex.status != "running":
        raise HTTPException(
            status_code=400,
            detail=f"Only running executions can be cancelled (current status: '{ex.status}')",
        )
    try:
        return execution_engine.cancel_execution(db, execution_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{execution_id}/resume", response_model=ExecutionResponse, status_code=202)
def resume_execution(
    execution_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Resume a failed or cancelled execution from the step it stopped at."""
    ex = execution_engine.get_execution(db, execution_id)
    if not ex:
        raise HTTPException(status_code=404, detail="Execution not found")
    if ex.status not in ("failed", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail=f"Only failed or cancelled executions can be resumed (current status: '{ex.status}')",
        )
    background_tasks.add_task(execution_engine.resume_in_background, execution_id)
    return ex


@router.post("/{execution_id}/chat", response_model=ExecutionChatResponse)
async def chat_with_execution(
    execution_id: str,
    req: ExecutionChatRequest,
    db: Session = Depends(get_db),
):
    """Chat with the results of a completed (or failed) execution."""
    ex = execution_engine.get_execution(db, execution_id)
    if not ex:
        raise HTTPException(status_code=404, detail="Execution not found")

    wf = db.query(Workflow).filter(Workflow.id == ex.workflow_id).first()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    logs = execution_engine.get_execution_logs(db, execution_id)

    # ── Build steps summary from workflow definition ──────────────────────────
    steps = wf.workflow_json.get("steps", [])
    step_lines = []
    for i, s in enumerate(steps, 1):
        step_lines.append(
            f"  step_{i}: [{s.get('integration','?')}.{s.get('action','?')}] "
            f"{s.get('name','')} — {s.get('description','')}"
        )
    steps_summary = "\n".join(step_lines) if step_lines else "  (no steps)"

    # ── Build results summary from execution logs ─────────────────────────────
    # Group ALL logs per step (a step can have multiple: initial failure + agent recovery)
    log_groups: dict[int, list] = {}
    for log in logs:
        log_groups.setdefault(log.step_index, []).append(log)

    result_lines = []
    for i, s in enumerate(steps):
        step_logs = log_groups.get(i, [])
        if not step_logs:
            result_lines.append(f"  step_{i+1} ({s.get('name','')}): did not run")
            continue

        # Final log determines ultimate status; earlier logs may show the initial failure
        final_log = step_logs[-1]
        status = final_log.status.upper()

        # Detect agent-fixed steps: multiple logs where earlier ones failed
        agent_recovered = (
            len(step_logs) > 1
            and any(l.status == "failed" for l in step_logs[:-1])
            and final_log.status == "success"
        )
        recovery_note = " (initially failed — recovered automatically by the failure agent)" if agent_recovered else ""

        if final_log.output_data:
            out_str = json.dumps(final_log.output_data, default=str)
            if len(out_str) > 600:
                out_str = out_str[:600] + "…"
            result_lines.append(f"  step_{i+1} ({s.get('name','')}): {status}{recovery_note} → {out_str}")
        elif final_log.error:
            result_lines.append(f"  step_{i+1} ({s.get('name','')}): {status}{recovery_note} — ERROR: {final_log.error}")
        else:
            result_lines.append(f"  step_{i+1} ({s.get('name','')}): {status}{recovery_note}")

        # Include the original failure message so the LLM can explain what went wrong
        if agent_recovered:
            first_failure = next((l for l in step_logs if l.status == "failed"), None)
            if first_failure and first_failure.error:
                result_lines.append(f"    (original error before recovery: {first_failure.error})")

    results_summary = "\n".join(result_lines) if result_lines else "  (no results)"

    # ── Build system prompt ───────────────────────────────────────────────────
    from app.prompts import EXECUTION_CHAT_SYSTEM
    system_prompt = EXECUTION_CHAT_SYSTEM.format(
        workflow_name=wf.name,
        original_input=wf.original_input,
        steps_summary=steps_summary,
        results_summary=results_summary,
    )

    # ── Call LLM ─────────────────────────────────────────────────────────────
    from app.core.config import get_settings
    s = get_settings()

    messages = [{"role": m.role, "content": m.content} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    if s.ai_provider == "openrouter":
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=s.openrouter_api_key, base_url=s.openrouter_base_url)
        resp = await client.chat.completions.create(
            model=s.openrouter_model,
            max_tokens=1024,
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )
        reply = resp.choices[0].message.content or ""
    elif s.ai_provider == "groq":
        from groq import AsyncGroq
        client = AsyncGroq(api_key=s.groq_api_key)
        resp = await client.chat.completions.create(
            model=s.groq_model,
            max_tokens=1024,
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )
        reply = resp.choices[0].message.content or ""
    else:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key)
        resp = await client.messages.create(
            model=s.ai_model,
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
        )
        reply = resp.content[0].text or ""

    return ExecutionChatResponse(reply=reply)
