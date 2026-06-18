# =============================================================================
# workflow/engine/execution_engine.py — Step runner and execution lifecycle
#
# The core engine that actually executes workflow steps. Handles the full
# lifecycle from creating an Execution record to writing per-step logs.
#
# run_execution(db, execution_id)
#   The central function. Loads the workflow definition, sets status=running,
#   then iterates over steps starting at execution.current_step (for resumes).
#   For each step:
#     1. _resolve_params()        — substitutes ${step_N.field} references
#     2. _assert_no_unresolved_refs() — fails fast on unresolved placeholders
#     3. _execute_step_with_retry() — calls the integration, retries once on failure
#     4. run_failure_agent()      — last-resort LangGraph recovery if retry fails
#   Checks for "cancelled" status before each step so user-requested stops
#   take effect at the next step boundary.
#
# _resolve_params(params, step_outputs) → dict
#   Two-pass resolver for ${...} references:
#     Full-value refs: "${step_1.emails}" → replaces the whole string with the
#       Python value (list, dict, etc.) so downstream steps receive real types.
#     Inline refs: "Hello ${step_2.name}!" → embedded string interpolation.
#   Supports dotted paths, array indexing ([0]), array shortcuts (.length,
#   .first, .last, .[*]), and special dates (${today}, ${now}).
#
# _execute_step_with_retry(db, execution_id, step_index, step, params)
#   Attempts to run a step up to MAX_RETRIES+1 times (default: 2 total).
#   Calls IntegrationRegistry.get(step.integration).execute(action, params).
#   Writes an ExecutionLog row on every attempt (success or failure).
#
# 4-layer recovery on failure (outermost to innermost):
#   Layer 1 (inside BaseIntegration.execute): _recover_fixable() — pure Python
#   Layer 2 (inside BaseIntegration.execute): _run_recovery_agent() — inline LangGraph
#   Layer 3 (this file):    MAX_RETRIES raw re-attempt
#   Layer 4 (this file):    run_failure_agent() — full LangGraph failure-recovery agent
#
# Supporting functions:
#   create_execution()              → creates a fresh Execution row (status=pending)
#   create_execution_from_step()    → creates execution seeded with prior step outputs
#   get_execution() / list_executions() / get_execution_logs() → read-only queries
#   cancel_execution()              → sets status=cancelled (checked at next step)
#   resume_execution()              → resets status=running, calls run_execution()
#   run_in_background()             → creates its own DB session for background task use
#   run_scheduled_workflow()        → called by the APScheduler _fire_workflow callback
# =============================================================================
import asyncio
import uuid
import json
import logging
import time
from datetime import datetime, UTC
from sqlalchemy.orm import Session
from app.workflow.db_models import Execution, ExecutionLog, Workflow
from app.workflow.integrations import IntegrationRegistry
from app.workflow.integrations.base import HumanInputRequired
from app.workflow.schemas import WorkflowDefinition, StepSchema

logger = logging.getLogger(__name__)

MAX_RETRIES = 1          # integrations self-heal via BaseIntegration recovery; engine just needs one fallback
RETRY_DELAY_SECONDS = 1


class EmptyResultsError(Exception):
    """Raised when a step output list is empty and a downstream step tries to index into it."""


# ── SSE push infrastructure ───────────────────────────────────────────────────
# One asyncio.Queue per active streaming client. The background execution thread
# pushes events via call_soon_threadsafe; the async SSE generator drains them.

_execution_queues: dict[str, asyncio.Queue] = {}
_event_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _event_loop
    _event_loop = loop


def register_stream_queue(execution_id: str, queue: asyncio.Queue) -> None:
    _execution_queues[execution_id] = queue


def deregister_stream_queue(execution_id: str) -> None:
    _execution_queues.pop(execution_id, None)


def _notify(execution_id: str, payload: dict) -> None:
    """Push an SSE event from the sync background thread to the async queue."""
    queue = _execution_queues.get(execution_id)
    if queue is None or _event_loop is None or _event_loop.is_closed():
        return
    _event_loop.call_soon_threadsafe(queue.put_nowait, payload)


# ── Execution record management ──────────────────────────────────────────────

def create_execution(db: Session, workflow_id: str) -> Execution:
    execution = Execution(
        id=str(uuid.uuid4()),
        workflow_id=workflow_id,
        status="pending",
        current_step=0,
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)
    return execution


def create_execution_from_step(db: Session, workflow_id: str, start_from_step: int) -> Execution:
    """Create an execution that begins at `start_from_step`, seeding prior outputs from the
    most recent successful run so step-output chaining (${step_N.field}) still works."""
    execution = Execution(
        id=str(uuid.uuid4()),
        workflow_id=workflow_id,
        status="pending",
        current_step=start_from_step,
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)

    if start_from_step > 0:
        # Find most recent completed execution to copy its output logs
        prior = (
            db.query(Execution)
            .filter(
                Execution.workflow_id == workflow_id,
                Execution.status == "success",
                Execution.id != execution.id,
            )
            .order_by(Execution.completed_at.desc())
            .first()
        )
        if prior:
            seed_logs = (
                db.query(ExecutionLog)
                .filter(
                    ExecutionLog.execution_id == prior.id,
                    ExecutionLog.status == "success",
                    ExecutionLog.step_index < start_from_step,
                )
                .all()
            )
            for log in seed_logs:
                db.add(ExecutionLog(
                    id=str(uuid.uuid4()),
                    execution_id=execution.id,
                    step_index=log.step_index,
                    step_name=log.step_name,
                    integration=log.integration,
                    action=log.action,
                    status="success",
                    input_data=log.input_data,
                    output_data=log.output_data,
                    error=None,
                    retry_count=0,
                ))
            db.commit()

    return execution


def get_execution(db: Session, execution_id: str) -> Execution | None:
    return db.query(Execution).filter(Execution.id == execution_id).first()


def get_execution_logs(db: Session, execution_id: str) -> list[ExecutionLog]:
    return (
        db.query(ExecutionLog)
        .filter(ExecutionLog.execution_id == execution_id)
        .order_by(ExecutionLog.step_index, ExecutionLog.created_at)
        .all()
    )


def list_executions(db: Session, workflow_id: str) -> list[Execution]:
    return (
        db.query(Execution)
        .filter(Execution.workflow_id == workflow_id)
        .order_by(Execution.started_at.desc())
        .all()
    )


# ── Step output chaining ─────────────────────────────────────────────────────

def _resolve_params(params: dict, step_outputs: dict[int, dict]) -> dict:
    """Walk params and replace step references with actual values from prior steps."""

    def _resolve_ref(ref: str):
        """Turn 'step_2.emails[0].id' or 'today' into the actual Python value."""
        if ref == "today":
            return datetime.now(UTC).strftime("%Y-%m-%d")
        if ref == "now":
            return datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")

        if not ref.startswith("step_"):
            return None

        parts = ref.split(".")
        underscore = parts[0].find("_")
        try:
            step_idx = int(parts[0][underscore + 1:]) - 1
        except (ValueError, IndexError):
            return None

        if step_idx not in step_outputs:
            return None

        return _walk(step_outputs[step_idx], parts[1:])

    def _walk(value, parts: list):
        """Follow a dotted path like ['emails[0]', 'id'] into value."""
        if not parts:
            return value

        part = parts[0]
        rest = parts[1:]
        bracket = part.find("[")

        if bracket != -1:
            key      = part[:bracket]
            accessor = part[bracket + 1:-1]  # content between [ and ]

            if not (isinstance(value, dict) and key in value):
                return None
            lst = value[key]

            if accessor == "*":
                if not isinstance(lst, list):
                    return None
                if rest:
                    return [(_walk(item, rest) or "") for item in lst]
                return lst

            try:
                idx = int(accessor)
            except ValueError:
                return None

            if not isinstance(lst, list):
                return None
            if idx >= len(lst):
                raise EmptyResultsError(
                    f"Step returned 0 results for '{key}'. "
                    "No data to process — the search query found nothing."
                )
            return _walk(lst[idx], rest)

        if part == "length" and isinstance(value, list):
            return _walk(len(value), rest)
        if part == "first" and isinstance(value, list):
            return _walk(value[0] if value else None, rest)
        if part == "last" and isinstance(value, list):
            return _walk(value[-1] if value else None, rest)
        if isinstance(value, dict) and part in value:
            return _walk(value[part], rest)

        return None

    def _resolve_str(s: str):
        """Replace all ${...} placeholders in a string value."""
        if "${" not in s:
            return s

        # Full-value ref: the whole string is "${step_N.field}" → preserve Python type
        stripped = s.strip()
        if stripped.startswith("${") and stripped.endswith("}") and stripped.count("${") == 1:
            ref      = stripped[2:-1]
            resolved = _resolve_ref(ref)
            if resolved is not None:
                return resolved

        # Inline ref: "${...}" is embedded inside a larger string → always a string
        result    = ""
        remaining = s
        while "${" in remaining:
            before, tail = remaining.split("${", 1)
            result += before
            if "}" in tail:
                ref, remaining = tail.split("}", 1)
                resolved = _resolve_ref(ref)
                if resolved is not None:
                    result += json.dumps(resolved) if isinstance(resolved, (dict, list)) else str(resolved)
                else:
                    result += "${" + ref + "}"
            else:
                result += "${" + tail
                remaining = ""
        result += remaining
        return result

    def _resolve_node(node):
        if isinstance(node, dict):
            return {k: _resolve_node(v) for k, v in node.items()}
        if isinstance(node, list):
            return [_resolve_node(item) for item in node]
        if isinstance(node, str):
            return _resolve_str(node)
        return node

    return _resolve_node(params)


# ── Core execution ────────────────────────────────────────────────────────────

def _assert_no_unresolved_refs(params: dict, step_name: str) -> None:
    """Raise if any ${step_N.field} placeholders survived resolution."""
    unresolved = []

    def _check(node):
        if isinstance(node, dict):
            for v in node.values():
                _check(v)
        elif isinstance(node, list):
            for item in node:
                _check(item)
        elif isinstance(node, str):
            remaining = node
            while "${step_" in remaining:
                _, tail = remaining.split("${step_", 1)
                if "}" in tail:
                    ref, remaining = tail.split("}", 1)
                    unresolved.append("step_" + ref)
                else:
                    break

    _check(params)
    if unresolved:
        raise ValueError(
            f"Step '{step_name}' has unresolved output references: "
            + ", ".join(f"${{{r}}}" for r in unresolved)
            + ". Make sure the referenced step ran successfully and the step number is correct "
            "(N in ${step_N.field} is 1-based and must point to a PREVIOUS step, not the current one)."
        )


def run_execution(db: Session, execution_id: str) -> Execution:
    execution = get_execution(db, execution_id)
    if not execution:
        raise ValueError(f"Execution '{execution_id}' not found")

    wf = db.query(Workflow).filter(Workflow.id == execution.workflow_id).first()
    if not wf:
        raise ValueError("Parent workflow not found")

    definition = WorkflowDefinition(**wf.workflow_json)
    steps = definition.steps

    execution.status = "running"
    execution.started_at = datetime.now(UTC)
    db.commit()

    logger.info("Execution %s started: %d step(s) for workflow '%s'", execution_id, len(steps), wf.name)

    # Collect outputs from already-completed steps (needed when resuming)
    step_outputs: dict[int, dict] = {}
    completed_logs = (
        db.query(ExecutionLog)
        .filter(ExecutionLog.execution_id == execution_id, ExecutionLog.status == "success")
        .order_by(ExecutionLog.step_index)
        .all()
    )
    for log in completed_logs:
        if log.output_data:
            step_outputs[log.step_index] = log.output_data

    # Resume from the step that previously failed (current_step is preserved on failure)
    for i, step in enumerate(steps[execution.current_step:], start=execution.current_step):
        execution.current_step = i
        db.commit()

        # Check for user-requested cancellation before starting each step
        db.refresh(execution)
        if execution.status == "cancelled":
            execution.completed_at = execution.completed_at or datetime.now(UTC)
            db.commit()
            logger.info("Execution %s cancelled by user at step %d", execution_id, i + 1)
            _notify(execution_id, {"type": "terminal", "status": "cancelled", "error": "Stopped by user", "current_step": i})
            return execution

        logger.info(
            "Execution %s — step %d/%d: %s.%s",
            execution_id, i + 1, len(steps), step.integration, step.action,
        )

        try:
            resolved_params = _resolve_params(step.params, step_outputs)
            _assert_no_unresolved_refs(resolved_params, step.name)
        except EmptyResultsError as exc:
            # Upstream step returned 0 results — expected, not a bug.
            # Skip remaining steps and close the execution as successful.
            logger.info("Execution %s — step %d skipped (empty upstream results): %s", execution_id, i + 1, exc)
            _write_log(
                db,
                execution_id=execution.id,
                step_index=i,
                step=step,
                status="skipped",
                input_data=step.params,
                output_data={"reason": str(exc)},
            )
            execution.status = "success"
            execution.error = None
            execution.completed_at = datetime.now(UTC)
            db.commit()
            db.refresh(execution)
            _notify(execution_id, {"type": "step", "step_index": i, "step_name": step.name, "integration": step.integration, "action": step.action, "status": "skipped", "error": None, "output_data": {"reason": str(exc)}, "retry_count": 0, "current_step": i})
            _notify(execution_id, {"type": "terminal", "status": "success", "error": None, "current_step": i})
            return execution
        except ValueError as exc:
            # Unresolved ${...} placeholder — fail the step and surface the error.
            error_msg = str(exc)
            logger.error("Execution %s — step %d param resolution failed: %s", execution_id, i + 1, error_msg)
            _write_log(
                db,
                execution_id=execution.id,
                step_index=i,
                step=step,
                status="failed",
                input_data=step.params,
                error=error_msg,
            )
            execution.status = "failed"
            execution.error = error_msg
            execution.completed_at = datetime.now(UTC)
            db.commit()
            db.refresh(execution)
            _notify(execution_id, {"type": "step", "step_index": i, "step_name": step.name, "integration": step.integration, "action": step.action, "status": "failed", "error": error_msg, "output_data": None, "retry_count": 0, "current_step": i})
            _notify(execution_id, {"type": "terminal", "status": "failed", "error": error_msg, "current_step": i})
            return execution

        try:
            result = _execute_step_with_retry(db, execution.id, i, step, resolved_params)
        except HumanInputRequired as hitl:
            pending = {
                "question":        hitl.question,
                "integration":     hitl.integration_name,
                "resource_type":   hitl.resource_type,
                "resource_name":   hitl.resource_name,
                "step_index":      i,
                "step_name":       step.name,
                **hitl.extra,
            }
            execution.status = "waiting_input"
            execution.pending_input = pending
            execution.current_step = i
            execution.completed_at = datetime.now(UTC)
            db.commit()
            logger.info(
                "Execution %s paused at step %d — waiting for user input: %s",
                execution_id, i + 1, hitl.question,
            )
            _notify(execution_id, {"type": "waiting_input", "pending_input": pending, "current_step": i})
            return execution

        if result["success"]:
            step_outputs[i] = result["output"]
            logger.info("Execution %s — step %d succeeded", execution_id, i + 1)
            _notify(execution_id, {"type": "step", "step_index": i, "step_name": step.name, "integration": step.integration, "action": step.action, "status": "success", "error": None, "output_data": result["output"], "retry_count": 0, "current_step": i + 1})

        if not result["success"]:
            logger.error(
                "Execution %s — step %d failed after retries: %s. Invoking recovery agent.",
                execution_id, i + 1, result["error"],
            )

            from app.workflow.agent.failure_agent import run_failure_agent  # lazy import

            agent_result = run_failure_agent(
                step_integration=step.integration,
                step_action=step.action,
                step_name=step.name,
                original_params=resolved_params,
                error_message=result["error"] or "",
                step_outputs=step_outputs,
            )

            if agent_result["fixed"] and agent_result["output"] is not None:
                logger.info("Execution %s — step %d recovered by agent", execution_id, i + 1)
                _write_log(
                    db,
                    execution_id=execution.id,
                    step_index=i,
                    step=step,
                    status="success",
                    input_data=resolved_params,
                    output_data=agent_result["output"],
                    retry_count=0,
                )
                step_outputs[i] = agent_result["output"]
                _notify(execution_id, {"type": "step", "step_index": i, "step_name": step.name, "integration": step.integration, "action": step.action, "status": "success", "error": None, "output_data": agent_result["output"], "retry_count": 0, "current_step": i + 1})
                continue

            error_msg = agent_result["error"] or result["error"]
            execution.status = "failed"
            execution.error = error_msg
            execution.completed_at = datetime.now(UTC)
            db.commit()
            db.refresh(execution)
            logger.error("Execution %s failed at step %d: %s", execution_id, i + 1, execution.error)
            _notify(execution_id, {"type": "step", "step_index": i, "step_name": step.name, "integration": step.integration, "action": step.action, "status": "failed", "error": error_msg, "output_data": None, "retry_count": MAX_RETRIES, "current_step": i})
            _notify(execution_id, {"type": "terminal", "status": "failed", "error": error_msg, "current_step": i})
            return execution

    execution.status = "success"
    execution.error = None
    execution.completed_at = datetime.now(UTC)
    db.commit()
    db.refresh(execution)
    logger.info("Execution %s completed successfully", execution_id)
    _notify(execution_id, {"type": "terminal", "status": "success", "error": None, "current_step": len(steps)})
    return execution


def cancel_execution(db: Session, execution_id: str) -> Execution:
    """Request cancellation of a running execution.

    Sets status to 'cancelled' in the DB. The background task detects this
    at the next step boundary and stops cleanly, preserving current_step so
    the execution can be resumed later.
    """
    execution = get_execution(db, execution_id)
    if not execution:
        raise ValueError(f"Execution '{execution_id}' not found")
    if execution.status != "running":
        raise ValueError(f"Only running executions can be cancelled (current status: {execution.status})")
    execution.status = "cancelled"
    execution.error = "Stopped by user"
    db.commit()
    db.refresh(execution)
    logger.info("Execution %s cancellation requested", execution_id)
    return execution


def resume_execution(db: Session, execution_id: str) -> Execution:
    """Resume a failed or cancelled execution from the step it stopped at."""
    execution = get_execution(db, execution_id)
    if not execution:
        raise ValueError(f"Execution '{execution_id}' not found")
    if execution.status not in ("failed", "cancelled"):
        raise ValueError(f"Only failed or cancelled executions can be resumed (current status: {execution.status})")

    execution.status = "running"
    execution.error = None
    db.commit()

    return run_execution(db, execution_id)


# ── Background task entry points (create their own DB session) ────────────────

def run_in_background(execution_id: str) -> None:
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        run_execution(db, execution_id)
    finally:
        db.close()


def resume_in_background(execution_id: str) -> None:
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        resume_execution(db, execution_id)
    finally:
        db.close()


def respond_to_execution(db: Session, execution_id: str, choice: str) -> Execution:
    """Process a human-in-the-loop response for a waiting_input execution.

    choice="create" — creates the missing resource then resumes from current_step.
    choice="skip"   — writes a skipped log and advances past the waiting step.
    """
    execution = get_execution(db, execution_id)
    if not execution:
        raise ValueError(f"Execution '{execution_id}' not found")
    if execution.status != "waiting_input":
        raise ValueError(
            f"Execution is not waiting for input (current status: '{execution.status}')"
        )

    pending = execution.pending_input or {}
    integration_name = pending.get("integration", "")
    resource_type    = pending.get("resource_type", "")
    resource_name    = pending.get("resource_name", "")
    step_index       = pending.get("step_index", execution.current_step)

    if choice == "create":
        # Delegate resource creation to the integration — no hardcoded names needed
        IntegrationRegistry.get(integration_name).create_resource(
            resource_type, resource_name, pending
        )

        # Resume from the same step (resource now exists — it should succeed)
        execution.status = "pending"
        execution.pending_input = None
        execution.error = None
        execution.completed_at = None
        db.commit()

    elif choice == "skip":
        # Write a skipped log entry for the current step
        wf = db.query(Workflow).filter(Workflow.id == execution.workflow_id).first()
        steps = (wf.workflow_json.get("steps", []) if wf else [])
        step_def = steps[step_index] if step_index < len(steps) else {}

        db.add(ExecutionLog(
            id=str(uuid.uuid4()),
            execution_id=execution_id,
            step_index=step_index,
            step_name=pending.get("step_name", step_def.get("name", f"step_{step_index + 1}")),
            integration=step_def.get("integration", integration_name),
            action=step_def.get("action", ""),
            status="skipped",
            input_data={},
            output_data={"reason": "Skipped by user"},
            error=None,
            retry_count=0,
        ))

        next_step = step_index + 1
        total_steps = len(steps)

        if next_step >= total_steps:
            # No more steps — mark the whole execution as success
            execution.status = "success"
            execution.pending_input = None
            execution.error = None
            execution.current_step = next_step
            execution.completed_at = datetime.now(UTC)
            db.commit()
            db.refresh(execution)
            return execution

        execution.status = "pending"
        execution.pending_input = None
        execution.error = None
        execution.current_step = next_step
        execution.completed_at = None
        db.commit()

    else:
        raise ValueError(f"Unknown choice '{choice}': expected 'create' or 'skip'")

    db.refresh(execution)
    return execution


def respond_in_background(execution_id: str) -> None:
    """Background entry point used after respond_to_execution sets status=pending."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        run_execution(db, execution_id)
    finally:
        db.close()


def run_scheduled_workflow(db: Session, workflow_id: str) -> None:
    """Called by the scheduler at cron fire time."""
    wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not wf:
        logger.error("Scheduled run: workflow %s not found", workflow_id)
        return
    if not wf.schedule_enabled:
        logger.info("Scheduled run: workflow %s has schedule_enabled=False — skipping", workflow_id)
        return

    execution = create_execution(db, workflow_id)
    logger.info("Scheduled execution %s started for workflow %s", execution.id, workflow_id)
    run_execution(db, execution.id)


# ── Step execution with retry logic ──────────────────────────────────────────

def _execute_step_with_retry(
    db: Session,
    execution_id: str,
    step_index: int,
    step: StepSchema,
    resolved_params: dict | None = None,
) -> dict:
    """
    Try to execute a single step up to MAX_RETRIES times.
    Logs every attempt. Returns {"success": bool, "output": dict | None, "error": str | None}.
    """
    params = resolved_params if resolved_params is not None else step.params
    last_error: str | None = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            integration = IntegrationRegistry.get(step.integration)
            output = integration.execute(step.action, params)

            _write_log(
                db,
                execution_id=execution_id,
                step_index=step_index,
                step=step,
                status="success",
                input_data=params,
                output_data=output,
                retry_count=attempt,
            )
            return {"success": True, "output": output}

        except HumanInputRequired:
            raise  # must bubble up to run_execution — do not treat as a retryable failure
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "Step '%s' failed (attempt %d/%d): %s",
                step.name, attempt + 1, MAX_RETRIES + 1, exc,
            )
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS)

    _write_log(
        db,
        execution_id=execution_id,
        step_index=step_index,
        step=step,
        status="failed",
        input_data=params,
        output_data=None,
        error=last_error,
        retry_count=MAX_RETRIES,
    )
    return {"success": False, "error": f"Step '{step.name}' failed after {MAX_RETRIES} retries: {last_error}"}


def _write_log(
    db: Session,
    execution_id: str,
    step_index: int,
    step: StepSchema,
    status: str,
    output_data: dict | None,
    input_data: dict | None = None,
    error: str | None = None,
    retry_count: int = 0,
) -> None:
    log = ExecutionLog(
        id=str(uuid.uuid4()),
        execution_id=execution_id,
        step_index=step_index,
        step_name=step.name,
        integration=step.integration,
        action=step.action,
        status=status,
        input_data=input_data if input_data is not None else step.params,
        output_data=output_data,
        error=error,
        retry_count=retry_count,
    )
    db.add(log)
    db.commit()
