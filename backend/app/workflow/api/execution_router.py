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


@router.post("/{execution_id}/resume", response_model=ExecutionResponse, status_code=202)
def resume_execution(
    execution_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Resume a failed execution from the step it stopped at."""
    ex = execution_engine.get_execution(db, execution_id)
    if not ex:
        raise HTTPException(status_code=404, detail="Execution not found")
    if ex.status != "failed":
        raise HTTPException(
            status_code=400,
            detail=f"Only failed executions can be resumed (current status: '{ex.status}')",
        )
    background_tasks.add_task(execution_engine.resume_in_background, execution_id)
    # Return immediately with status still as "failed"; client should poll
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
    log_map: dict[int, object] = {}
    for log in logs:
        log_map[log.step_index] = log

    result_lines = []
    for i, s in enumerate(steps):
        log = log_map.get(i)
        if log is None:
            result_lines.append(f"  step_{i+1} ({s.get('name','')}): did not run")
            continue
        status = log.status.upper()
        if log.output_data:
            # Trim large outputs so they fit in the context window
            out_str = json.dumps(log.output_data, default=str)
            if len(out_str) > 600:
                out_str = out_str[:600] + "…"
            result_lines.append(f"  step_{i+1} ({s.get('name','')}): {status} → {out_str}")
        elif log.error:
            result_lines.append(f"  step_{i+1} ({s.get('name','')}): {status} — ERROR: {log.error}")
        else:
            result_lines.append(f"  step_{i+1} ({s.get('name','')}): {status}")
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
