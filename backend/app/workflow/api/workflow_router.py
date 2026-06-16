import uuid
from datetime import datetime, UTC  # UTC used by approve/reject/schedule/step endpoints
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.workflow.schemas import (
    ApproveRequest,
    RejectRequest,
    ReplanRequest,
    CreateWorkflowRequest,
    UpdateWorkflowRequest,
    ScheduleUpdateRequest,
    StepAddRequest,
    StepUpdateRequest,
    StepSchema,
    WorkflowResponse,
    WorkflowVersionResponse,
    ExecutionResponse,
    ExecuteRequest,
)
from app.workflow.planner import plan_workflow
from app.workflow.engine import workflow_engine, execution_engine
from app.workflow.engine.workflow_engine import save_step_version
from app.scheduler import (
    register_workflow_schedule,
    unschedule_workflow,
    get_next_run_time,
)

router = APIRouter()


def _enrich(wf) -> WorkflowResponse:
    """Convert ORM Workflow → WorkflowResponse and inject next_run from scheduler."""
    resp = WorkflowResponse.model_validate(wf)
    resp.next_run = get_next_run_time(wf.id)
    return resp


def _get_or_404(db: Session, workflow_id: str):
    wf = workflow_engine.get_workflow(db, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return wf


# ── Workflow CRUD ─────────────────────────────────────────────────────────────

@router.post("/", response_model=WorkflowResponse, status_code=201)
async def create_workflow(req: CreateWorkflowRequest, db: Session = Depends(get_db)):
    """Convert natural language to a structured workflow and persist it as a draft."""
    try:
        definition = await plan_workflow(req.natural_language)
        wf = workflow_engine.create_workflow(db, req.natural_language, definition)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return _enrich(wf)


@router.get("/", response_model=list[WorkflowResponse])
def list_workflows(
    status: str | None = None,
    db: Session = Depends(get_db),
):
    """List all stored workflows. Optionally filter by status (draft|approved|rejected)."""
    workflows = workflow_engine.list_workflows(db)
    if status:
        workflows = [wf for wf in workflows if wf.status == status]
    return [_enrich(wf) for wf in workflows]


@router.get("/{workflow_id}", response_model=WorkflowResponse)
def get_workflow(workflow_id: str, db: Session = Depends(get_db)):
    """Fetch a single workflow by ID including all steps and status."""
    return _enrich(_get_or_404(db, workflow_id))


@router.put("/{workflow_id}", response_model=WorkflowResponse)
def update_workflow(
    workflow_id: str,
    req: UpdateWorkflowRequest,
    db: Session = Depends(get_db),
):
    """Edit a workflow's name or full step definitions. Resets status to draft."""
    try:
        wf = workflow_engine.update_workflow(db, workflow_id, req.name, req.workflow_json)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return _enrich(wf)


@router.delete("/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, db: Session = Depends(get_db)):
    """Delete a workflow and all its executions."""
    if not workflow_engine.delete_workflow(db, workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")


# ── Workflow Review — inspect, modify, approve ────────────────────────────────

@router.post("/{workflow_id}/approve", response_model=ExecutionResponse | WorkflowResponse, status_code=202)
def approve_workflow(
    workflow_id: str,
    req: ApproveRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Approve a workflow for execution.
    - Sets status to 'approved'.
    - If req.execute=True (default), starts execution immediately and returns ExecutionResponse.
    - If req.execute=False, only marks as approved and returns WorkflowResponse.
    """
    wf = _get_or_404(db, workflow_id)

    if wf.status == "rejected":
        raise HTTPException(
            status_code=422,
            detail="Cannot approve a rejected workflow. Edit it first to reset it to draft.",
        )

    wf.status = "approved"
    wf.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(wf)

    if req.execute:
        execution = execution_engine.create_execution(db, workflow_id)
        background_tasks.add_task(execution_engine.run_in_background, execution.id)
        return execution

    return _enrich(wf)


@router.post("/{workflow_id}/reject", response_model=WorkflowResponse)
def reject_workflow(
    workflow_id: str,
    req: RejectRequest,
    db: Session = Depends(get_db),
):
    """
    Reject a workflow — marks it as rejected and optionally records a reason.
    A rejected workflow must be edited (PUT) before it can be approved again.
    """
    wf = _get_or_404(db, workflow_id)

    wf.status = "rejected"
    wf.updated_at = datetime.now(UTC)
    # Store rejection reason in explanation if provided
    if req.reason:
        current = wf.workflow_json or {}
        current["rejection_reason"] = req.reason
        wf.workflow_json = current

    db.commit()
    db.refresh(wf)
    return _enrich(wf)


# ── Step-level CRUD ───────────────────────────────────────────────────────────

@router.get("/{workflow_id}/steps", response_model=list[dict])
def list_steps(workflow_id: str, db: Session = Depends(get_db)):
    """Return all steps for a workflow with their current params."""
    wf = _get_or_404(db, workflow_id)
    return (wf.workflow_json or {}).get("steps", [])


@router.post("/{workflow_id}/steps", response_model=WorkflowResponse, status_code=201)
def add_step(
    workflow_id: str,
    req: StepAddRequest,
    db: Session = Depends(get_db),
):
    """
    Add a new step to a workflow.
    Pass insert_after=<step_id> to insert at a specific position; omit to append at the end.
    Resets workflow status to draft.
    """
    wf = _get_or_404(db, workflow_id)
    wf_json = dict(wf.workflow_json or {})
    steps: list[dict] = list(wf_json.get("steps", []))

    new_step = StepSchema(
        id=f"step_{uuid.uuid4().hex[:8]}",
        name=req.name,
        integration=req.integration,
        action=req.action,
        params=req.params,
        description=req.description,
    ).model_dump()

    if req.insert_after:
        idx = next((i for i, s in enumerate(steps) if s["id"] == req.insert_after), None)
        if idx is None:
            raise HTTPException(status_code=404, detail=f"Step '{req.insert_after}' not found")
        steps.insert(idx + 1, new_step)
    else:
        steps.append(new_step)

    wf_json["steps"] = steps
    wf.workflow_json = wf_json
    wf.status = "draft"
    wf.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(wf)

    save_step_version(db, wf, f"Added step '{req.name}'")
    return _enrich(wf)


@router.patch("/{workflow_id}/steps/{step_id}", response_model=WorkflowResponse)
def update_step(
    workflow_id: str,
    step_id: str,
    req: StepUpdateRequest,
    db: Session = Depends(get_db),
):
    """
    Update fields of a specific step in-place (name, action, params, description).
    Only provided fields are changed — unspecified fields remain unchanged.
    Resets workflow status to draft.
    """
    wf = _get_or_404(db, workflow_id)
    wf_json = dict(wf.workflow_json or {})
    steps: list[dict] = list(wf_json.get("steps", []))

    idx = next((i for i, s in enumerate(steps) if s["id"] == step_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Step '{step_id}' not found in workflow")

    step = dict(steps[idx])
    if req.name is not None:
        step["name"] = req.name
    if req.integration is not None:
        step["integration"] = req.integration
    if req.action is not None:
        step["action"] = req.action
    if req.params is not None:
        step["params"] = req.params
    if req.description is not None:
        step["description"] = req.description

    steps[idx] = step
    wf_json["steps"] = steps
    wf.workflow_json = wf_json
    wf.status = "draft"
    wf.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(wf)

    save_step_version(db, wf, f"Updated step '{step['name']}'")
    return _enrich(wf)


@router.delete("/{workflow_id}/steps/{step_id}", response_model=WorkflowResponse)
def delete_step(
    workflow_id: str,
    step_id: str,
    db: Session = Depends(get_db),
):
    """
    Remove a step from a workflow.
    Resets workflow status to draft.
    """
    wf = _get_or_404(db, workflow_id)
    wf_json = dict(wf.workflow_json or {})
    steps: list[dict] = list(wf_json.get("steps", []))

    step = next((s for s in steps if s["id"] == step_id), None)
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step '{step_id}' not found in workflow")

    steps = [s for s in steps if s["id"] != step_id]
    wf_json["steps"] = steps
    wf.workflow_json = wf_json
    wf.status = "draft"
    wf.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(wf)

    save_step_version(db, wf, f"Removed step '{step['name']}'")
    return _enrich(wf)


# ── Re-plan with AI ──────────────────────────────────────────────────────────

@router.post("/{workflow_id}/replan", response_model=WorkflowResponse)
async def replan_workflow(
    workflow_id: str,
    req: ReplanRequest,
    db: Session = Depends(get_db),
):
    """Re-invoke the LLM planner.

    If req.new_query is provided, plans with that text and stores it as the new
    original_input (so future replans without a query keep the updated intent).
    Otherwise replans with the stored original_input unchanged.
    Replaces steps/trigger/explanation, saves a version snapshot, resets to draft.
    """
    wf = _get_or_404(db, workflow_id)
    query = req.new_query.strip() if req.new_query else wf.original_input
    try:
        definition = await plan_workflow(query)
        updated = workflow_engine.update_workflow(db, workflow_id, wf.name, definition)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if req.new_query:
        updated.original_input = query
        db.commit()
        db.refresh(updated)
    return _enrich(updated)


# ── Execute directly (bypasses review) ───────────────────────────────────────

@router.post("/{workflow_id}/execute", response_model=ExecutionResponse, status_code=202)
def execute_workflow(
    workflow_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    req: ExecuteRequest = None,
):
    """Trigger workflow execution. Pass start_from_step > 0 to run only new/tail steps."""
    _get_or_404(db, workflow_id)
    start = (req.start_from_step if req else 0) or 0
    if start > 0:
        execution = execution_engine.create_execution_from_step(db, workflow_id, start)
    else:
        execution = execution_engine.create_execution(db, workflow_id)
    background_tasks.add_task(execution_engine.run_in_background, execution.id)
    return execution


# ── Version history ───────────────────────────────────────────────────────────

@router.get("/{workflow_id}/versions", response_model=list[WorkflowVersionResponse])
def list_versions(workflow_id: str, db: Session = Depends(get_db)):
    """Return all saved versions of a workflow, newest first, with structured diffs."""
    wf = _get_or_404(db, workflow_id)
    return workflow_engine.list_versions(db, wf.id)


@router.get("/{workflow_id}/executions", response_model=list[ExecutionResponse])
def list_executions(workflow_id: str, db: Session = Depends(get_db)):
    """List all executions for a workflow, newest first."""
    _get_or_404(db, workflow_id)
    return execution_engine.list_executions(db, workflow_id)


# ── Schedule management ───────────────────────────────────────────────────────

@router.get("/{workflow_id}/schedule/status", response_model=WorkflowResponse)
def get_schedule_status(workflow_id: str, db: Session = Depends(get_db)):
    """Return the workflow's current schedule configuration and next run time."""
    return _enrich(_get_or_404(db, workflow_id))


@router.post("/{workflow_id}/schedule/enable", response_model=WorkflowResponse)
def enable_schedule(
    workflow_id: str,
    req: ScheduleUpdateRequest,
    db: Session = Depends(get_db),
):
    """Enable scheduling. Reads cron expression from workflow_json.trigger.condition."""
    wf = _get_or_404(db, workflow_id)

    trigger = (wf.workflow_json or {}).get("trigger", {})
    if trigger.get("type") not in ("schedule", "cron"):
        raise HTTPException(
            status_code=422,
            detail="Workflow trigger type is not 'schedule'. Re-plan with a schedule-based description.",
        )

    cron_expr = trigger.get("condition", "")
    if not cron_expr:
        raise HTTPException(
            status_code=422,
            detail="No cron expression found in workflow_json.trigger.condition.",
        )

    tz = req.schedule_timezone or "UTC"
    if not register_workflow_schedule(wf.id, cron_expr, tz):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid cron expression: '{cron_expr}'.",
        )

    wf.schedule_enabled = True
    wf.schedule_timezone = tz
    wf.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(wf)
    return _enrich(wf)


@router.post("/{workflow_id}/schedule/disable", response_model=WorkflowResponse)
def disable_schedule(workflow_id: str, db: Session = Depends(get_db)):
    """Disable scheduling for a workflow (preserves the cron expression)."""
    wf = _get_or_404(db, workflow_id)
    unschedule_workflow(wf.id)
    wf.schedule_enabled = False
    wf.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(wf)
    return _enrich(wf)


@router.put("/{workflow_id}/schedule", response_model=WorkflowResponse)
def update_schedule(
    workflow_id: str,
    req: ScheduleUpdateRequest,
    db: Session = Depends(get_db),
):
    """Update schedule enabled state and/or timezone."""
    wf = _get_or_404(db, workflow_id)
    tz = req.schedule_timezone or "UTC"

    if req.schedule_enabled:
        trigger = (wf.workflow_json or {}).get("trigger", {})
        cron_expr = trigger.get("condition", "")
        if not register_workflow_schedule(wf.id, cron_expr, tz):
            raise HTTPException(
                status_code=422,
                detail=f"Cannot enable schedule: invalid cron expression '{cron_expr}'.",
            )
    else:
        unschedule_workflow(wf.id)

    wf.schedule_enabled = req.schedule_enabled
    wf.schedule_timezone = tz
    wf.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(wf)
    return _enrich(wf)
