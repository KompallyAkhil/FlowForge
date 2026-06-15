import uuid
from datetime import datetime, UTC
from sqlalchemy.orm import Session
from app.workflow.db_models import Workflow, WorkflowVersion
from app.workflow.schemas import WorkflowDefinition
from app.workflow.integrations.base import IntegrationRegistry


# ── Validation ────────────────────────────────────────────────────────────────

def validate_workflow(definition: WorkflowDefinition) -> list[str]:
    """Return a list of validation errors. Empty list means valid."""
    errors: list[str] = []

    if not definition.steps:
        errors.append("Workflow must have at least one step.")

    for i, step in enumerate(definition.steps, 1):
        try:
            IntegrationRegistry.get(step.integration)
        except KeyError as e:
            errors.append(f"Step {i}: {e}")

    return errors


# ── Structured diff ───────────────────────────────────────────────────────────

def _compute_diff(
    old_name: str,
    old_json: dict,
    new_name: str | None,
    new_def: WorkflowDefinition | None,
) -> tuple[str, list[dict]]:
    """
    Compare the current workflow state against proposed changes.
    Returns (human-readable summary, list of structured change dicts).
    Each change dict has at minimum a "field" key.
    """
    changes: list[dict] = []

    # ── Name change ───────────────────────────────────────────────────────────
    effective_name = (new_name or "").strip()
    if effective_name and effective_name != old_name:
        changes.append({"field": "name", "before": old_name, "after": effective_name})

    # ── Step-level diff ───────────────────────────────────────────────────────
    if new_def:
        old_steps: list[dict] = old_json.get("steps", [])
        new_steps: list[dict] = new_def.model_dump()["steps"]

        old_by_id = {s["id"]: s for s in old_steps}
        new_by_id = {s["id"]: s for s in new_steps}

        # Removed
        for sid, step in old_by_id.items():
            if sid not in new_by_id:
                changes.append({"field": "step_removed", "step_name": step["name"], "step_id": sid})

        # Added
        for sid, step in new_by_id.items():
            if sid not in old_by_id:
                changes.append({"field": "step_added", "step_name": step["name"], "step_id": sid})

        # Modified (present in both)
        for sid in old_by_id:
            if sid not in new_by_id:
                continue
            old_s = old_by_id[sid]
            new_s = new_by_id[sid]

            if new_s["name"] != old_s["name"]:
                changes.append({
                    "field": "step_name",
                    "step_id": sid,
                    "before": old_s["name"],
                    "after": new_s["name"],
                })

            old_act = f"{old_s['integration']}.{old_s['action']}"
            new_act = f"{new_s['integration']}.{new_s['action']}"
            if old_act != new_act:
                changes.append({
                    "field": "step_action",
                    "step_id": sid,
                    "step_name": new_s["name"],
                    "before": old_act,
                    "after": new_act,
                })

            if new_s["params"] != old_s["params"]:
                changes.append({
                    "field": "step_params",
                    "step_id": sid,
                    "step_name": new_s["name"],
                    "before": old_s["params"],
                    "after": new_s["params"],
                })

        # Reorder (among steps present in both)
        old_order = [s["id"] for s in old_steps if s["id"] in new_by_id]
        new_order = [s["id"] for s in new_steps if s["id"] in old_by_id]
        if old_order != new_order:
            changes.append({"field": "steps_reordered"})

    # ── Human-readable summary ────────────────────────────────────────────────
    if not changes:
        return "No changes", changes

    parts: list[str] = []
    for c in changes:
        f = c["field"]
        if f == "name":
            parts.append(f"Renamed to \"{c['after']}\"")
        elif f == "step_added":
            parts.append(f"Added step \"{c['step_name']}\"")
        elif f == "step_removed":
            parts.append(f"Removed step \"{c['step_name']}\"")
        elif f == "step_name":
            parts.append(f"Renamed step to \"{c['after']}\"")
        elif f == "step_action":
            parts.append(f"Changed \"{c['step_name']}\" action to {c['after']}")
        elif f == "step_params":
            parts.append(f"Updated params for \"{c['step_name']}\"")
        elif f == "steps_reordered":
            parts.append("Reordered steps")

    return "; ".join(parts), changes


# ── Version snapshotting ──────────────────────────────────────────────────────

def _next_version_number(db: Session, workflow_id: str) -> int:
    from sqlalchemy import func
    result = db.query(func.max(WorkflowVersion.version_number)).filter(
        WorkflowVersion.workflow_id == workflow_id
    ).scalar()
    return (result or 0) + 1


def _save_version(
    db: Session,
    wf: Workflow,
    change_summary: str,
    changed_fields: list[dict] | None,
) -> WorkflowVersion:
    ver = WorkflowVersion(
        id=str(uuid.uuid4()),
        workflow_id=wf.id,
        version_number=_next_version_number(db, wf.id),
        name=wf.name,
        workflow_json=wf.workflow_json,
        change_summary=change_summary,
        changed_fields=changed_fields,
    )
    db.add(ver)
    db.commit()
    db.refresh(ver)
    return ver


# ── Public version helpers ────────────────────────────────────────────────────

def save_step_version(db: Session, wf: Workflow, change_summary: str) -> WorkflowVersion:
    """Public wrapper used by step-level CRUD endpoints to record a version snapshot."""
    return _save_version(db, wf, change_summary, None)


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_workflow(db: Session, original_input: str, definition: WorkflowDefinition) -> Workflow:
    errors = validate_workflow(definition)
    if errors:
        raise ValueError(f"Invalid workflow: {'; '.join(errors)}")

    wf = Workflow(
        id=str(uuid.uuid4()),
        name=definition.name,
        original_input=original_input,
        workflow_json=definition.model_dump(),
        explanation=definition.explanation,
    )
    db.add(wf)
    db.commit()
    db.refresh(wf)

    # Version 1 — initial creation snapshot
    _save_version(db, wf, "Initial creation", None)
    return wf


def get_workflow(db: Session, workflow_id: str) -> Workflow | None:
    return db.query(Workflow).filter(Workflow.id == workflow_id).first()


def list_workflows(db: Session) -> list[Workflow]:
    return db.query(Workflow).order_by(Workflow.created_at.desc()).all()


def update_workflow(
    db: Session,
    workflow_id: str,
    name: str | None,
    definition: WorkflowDefinition | None,
) -> Workflow | None:
    wf = get_workflow(db, workflow_id)
    if not wf:
        return None

    # Compute diff BEFORE applying changes so we capture what actually changed
    summary, changed_fields = _compute_diff(wf.name, wf.workflow_json, name, definition)

    if name:
        wf.name = name

    if definition:
        errors = validate_workflow(definition)
        if errors:
            raise ValueError(f"Invalid workflow update: {'; '.join(errors)}")
        wf.workflow_json = definition.model_dump()
        wf.explanation = definition.explanation

        if wf.schedule_enabled and definition.trigger.type == "schedule":
            from app.scheduler import register_workflow_schedule
            cron_expr = definition.trigger.condition or ""
            register_workflow_schedule(wf.id, cron_expr, wf.schedule_timezone)

    wf.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(wf)

    # Save the post-update snapshot with what changed
    _save_version(db, wf, summary, changed_fields if changed_fields else None)
    return wf


def list_versions(db: Session, workflow_id: str) -> list[WorkflowVersion]:
    return (
        db.query(WorkflowVersion)
        .filter(WorkflowVersion.workflow_id == workflow_id)
        .order_by(WorkflowVersion.version_number.desc())
        .all()
    )


def delete_workflow(db: Session, workflow_id: str) -> bool:
    wf = get_workflow(db, workflow_id)
    if not wf:
        return False

    from app.scheduler import unschedule_workflow
    unschedule_workflow(wf.id)

    db.delete(wf)
    db.commit()
    return True
