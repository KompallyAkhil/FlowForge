import uuid
import re
import json
import logging
import time
from datetime import datetime, UTC
from sqlalchemy.orm import Session
from app.workflow.db_models import Execution, ExecutionLog, Workflow
from app.workflow.integrations import IntegrationRegistry
from app.workflow.schemas import WorkflowDefinition, StepSchema

logger = logging.getLogger(__name__)

MAX_RETRIES = 1          # integrations self-heal via BaseIntegration recovery; engine just needs one fallback
RETRY_DELAY_SECONDS = 1


class EmptyResultsError(Exception):
    """Raised when a step output list is empty and a downstream step tries to index into it."""


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
    """
    Replace ${step_N.field}, ${step_N.list[0].field}, and ${step_N.list[*].field}
    placeholders with actual values from previous step outputs. N is 1-indexed.

    Two-pass strategy:
      Pass 1 — "full-value" refs: when ${...} is the ENTIRE JSON string value,
                the surrounding quotes are replaced too so lists/dicts become
                real JSON arrays/objects (not strings).
      Pass 2 — inline refs: ${...} embedded inside a larger string stays a string.
    """
    params_str = json.dumps(params)

    def _resolve_ref(ref: str):
        """
        Resolve a dotted reference like 'step_1.channels[*].name' or
        'step_1.emails[0].id' to its Python value.
        Also resolves runtime date constants: ${today}, ${now}.
        Returns None when the path cannot be resolved.
        Raises EmptyResultsError when an indexed list exists but is empty.
        """
        # ── Runtime date/time constants ───────────────────────────────────────
        if ref == "today":
            return datetime.now(UTC).strftime("%Y-%m-%d")
        if ref == "now":
            return datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")

        parts = ref.split(".")
        step_part = parts[0]

        if not step_part.startswith("step_"):
            return None
        try:
            step_idx = int(step_part.split("_")[1]) - 1
        except (IndexError, ValueError):
            return None

        if step_idx not in step_outputs:
            return None

        value = step_outputs[step_idx]
        i = 0
        remaining = parts[1:]

        while i < len(remaining):
            part = remaining[i]

            # ── Wildcard [*]: channels[*] or channels[*].name ────────────────
            wildcard_m = re.match(r"^(\w+)\[\*\]$", part)
            if wildcard_m:
                key = wildcard_m.group(1)
                if not (isinstance(value, dict) and key in value):
                    return None
                lst = value[key]
                if not isinstance(lst, list):
                    return None
                sub_parts = remaining[i + 1:]          # path after [*]
                if sub_parts:
                    extracted = []
                    for item in lst:
                        v = item
                        for sp in sub_parts:
                            v = v.get(sp, "") if isinstance(v, dict) else ""
                        extracted.append(v)
                    return extracted
                return lst                              # no sub-path → whole array

            # ── Numeric index: emails[0] ─────────────────────────────────────
            arr_m = re.match(r"^(\w+)\[(\d+)\]$", part)
            if arr_m:
                key, idx = arr_m.group(1), int(arr_m.group(2))
                if isinstance(value, dict) and key in value:
                    lst = value[key]
                    if isinstance(lst, list) and idx < len(lst):
                        value = lst[idx]
                    elif isinstance(lst, list):
                        raise EmptyResultsError(
                            f"Step {step_idx + 1} returned 0 results for '{key}'. "
                            "No data to process — the search query found nothing."
                        )
                    else:
                        return None
                else:
                    return None
                i += 1
                continue

            # ── .length on a list → count ────────────────────────────────────
            if part == "length" and isinstance(value, list):
                value = len(value)
                i += 1
                continue

            # ── .first / .last on a list ─────────────────────────────────────
            if part == "first" and isinstance(value, list):
                value = value[0] if value else None
                i += 1
                continue
            if part == "last" and isinstance(value, list):
                value = value[-1] if value else None
                i += 1
                continue

            # ── Plain key ────────────────────────────────────────────────────
            if isinstance(value, dict) and part in value:
                value = value[part]
            else:
                return None
            i += 1

        return value

    # ── Pass 1: full-value replacement "\"${...}\"" ──────────────────────────
    # Regex captures ONLY the ref content (e.g. "step_1.emails"), NOT the ${} wrapper,
    # so _resolve_ref receives "step_1.emails" instead of "${step_1.emails}".
    # When the resolved value is a list or dict, the surrounding JSON quotes are removed
    # and the raw JSON array/object is substituted — preserving the correct Python type.
    def _replace_full(match: re.Match) -> str:
        ref   = match.group(1)
        value = _resolve_ref(ref)
        if value is None:
            return match.group(0)
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        return json.dumps(str(value))

    params_str = re.sub(r'"\$\{([^}]+)\}"', _replace_full, params_str)

    # ── Pass 2: inline replacement ${...} inside a larger string ─────────────
    def _replace_inline(match: re.Match) -> str:
        ref   = match.group(1)
        value = _resolve_ref(ref)
        if value is None:
            return match.group(0)
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        return json.dumps(str(value))[1:-1]   # strip outer quotes for inline use

    params_str = re.sub(r'\$\{([^}]+)\}',          _replace_inline, params_str)
    params_str = re.sub(r'\{\{\s*([^}]+?)\s*\}\}', _replace_inline, params_str)

    try:
        return json.loads(params_str)
    except json.JSONDecodeError:
        return params


# ── Core execution ────────────────────────────────────────────────────────────

def _assert_no_unresolved_refs(params: dict, step_name: str) -> None:
    """Raise a clear error if any ${step_N.field} placeholders survived resolution.

    This catches planner bugs (wrong step number, referencing the current step) before
    they silently write a literal placeholder string into Gmail, Slack, or Sheets.
    """
    params_str = json.dumps(params)
    # Only flag ${step_N.field} patterns — not generic ${variable} in email/text content.
    unresolved = re.findall(r'\$\{(step_[^}]+)\}', params_str)
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
            return execution

        result = _execute_step_with_retry(db, execution.id, i, step, resolved_params)

        if result["success"]:
            step_outputs[i] = result["output"]
            logger.info("Execution %s — step %d succeeded", execution_id, i + 1)

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
                continue

            execution.status = "failed"
            execution.error = agent_result["error"] or result["error"]
            execution.completed_at = datetime.now(UTC)
            db.commit()
            db.refresh(execution)
            logger.error("Execution %s failed at step %d: %s", execution_id, i + 1, execution.error)
            return execution

    execution.status = "success"
    execution.error = None
    execution.completed_at = datetime.now(UTC)
    db.commit()
    db.refresh(execution)
    logger.info("Execution %s completed successfully", execution_id)
    return execution


def resume_execution(db: Session, execution_id: str) -> Execution:
    """Resume a failed execution from the step it stopped at."""
    execution = get_execution(db, execution_id)
    if not execution:
        raise ValueError(f"Execution '{execution_id}' not found")
    if execution.status != "failed":
        raise ValueError(f"Only failed executions can be resumed (current status: {execution.status})")

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
