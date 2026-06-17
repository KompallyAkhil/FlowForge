# =============================================================================
# scheduler/scheduler.py — APScheduler-based cron scheduler for workflows
#
# Manages a single BackgroundScheduler instance that fires workflow executions
# at the times defined by their LLM-generated cron expressions. This runs
# as a background thread inside the FastAPI process — no separate worker.
#
# Key design decisions:
#   - MemoryJobStore (not SQLAlchemyJobStore) to avoid SQLite write contention
#     with the main app. Jobs are re-loaded from the DB on every startup via
#     load_scheduled_workflows().
#   - coalesce=True + max_instances=1 ensures a workflow that missed a fire
#     (e.g. server was down) only runs once on recovery, not for every missed slot.
#   - misfire_grace_time=300 (5 min) — if APScheduler can't fire within 5 min
#     of the scheduled time, it skips that fire rather than running late.
#
# Public API:
#   start_scheduler()                    → called once in main.py lifespan
#   stop_scheduler()                     → called on shutdown
#   load_scheduled_workflows()           → re-registers all enabled workflows from DB
#   register_workflow_schedule(id, cron) → adds/replaces a job for one workflow
#   unschedule_workflow(id)              → removes a job (idempotent)
#   get_next_run_time(id)                → returns next fire datetime or None
#
# _fire_workflow(workflow_id)
#   The APScheduler callback. Runs in a thread pool worker. Opens its own DB
#   session (can't share the request-scoped session) and calls
#   execution_engine.run_scheduled_workflow() to create and run the execution.
#
# Cron format: 5-field standard cron (minute hour day month day_of_week).
# The LLM planner writes this into workflow_json.trigger.condition.
# =============================================================================

import logging
import re
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from apscheduler.triggers.cron import CronTrigger
from apscheduler.executors.pool import ThreadPoolExecutor

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None

# ── Lifecycle ────────────────────────────────────────────────────────────────

def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        return

    _scheduler = BackgroundScheduler(
        jobstores={"default": MemoryJobStore()},
        executors={"default": ThreadPoolExecutor(max_workers=4)},
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 300},
    )
    _scheduler.start()
    logger.info("Workflow scheduler started")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Workflow scheduler stopped")


# ── Cron parsing ─────────────────────────────────────────────────────────────

_CRON_RE = re.compile(
    r"^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$"
)

def _parse_cron(expression: str | None) -> tuple[str, str, str, str, str] | None:
    """
    Parse a 5-field cron string: minute hour day month day_of_week.
    Returns (minute, hour, day, month, day_of_week) or None if unparseable.
    """
    if not expression:
        return None
    cleaned = expression.strip()
    m = _CRON_RE.match(cleaned)
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)


# ── Job management ────────────────────────────────────────────────────────────

def register_workflow_schedule(
    workflow_id: str,
    cron_expression: str,
    timezone: str = "UTC",
) -> bool:
    """
    Register (or replace) a scheduled job for a workflow.

    cron_expression must be a 5-field cron string stored by the planner, e.g.:
      "0 7 * * *"       → every day at 07:00
      "*/30 * * * *"    → every 30 minutes
      "0 9 * * 1"       → every Monday at 09:00
      "0 8,18 * * *"    → 08:00 and 18:00 every day
      "0 0 1 * *"       → first of every month at midnight
    """
    if _scheduler is None or not _scheduler.running:
        logger.warning("Scheduler not running — cannot register workflow %s", workflow_id)
        return False

    fields = _parse_cron(cron_expression)
    if not fields:
        logger.error(
            "Invalid cron expression '%s' for workflow %s — schedule not registered",
            cron_expression,
            workflow_id,
        )
        return False

    minute, hour, day, month, day_of_week = fields
    job_id = f"workflow_{workflow_id}"

    try:
        trigger = CronTrigger(
            minute=minute,
            hour=hour,
            day=day,
            month=month,
            day_of_week=day_of_week,
            timezone=timezone,
        )
        # replace_existing handles both new registration and cron updates
        _scheduler.add_job(
            _fire_workflow,
            trigger=trigger,
            id=job_id,
            args=[workflow_id],
            replace_existing=True,
        )
        logger.info(
            "Scheduled workflow %s with cron '%s' tz=%s (job_id=%s)",
            workflow_id, cron_expression, timezone, job_id,
        )
        return True
    except Exception as exc:
        logger.error("Failed to schedule workflow %s: %s", workflow_id, exc)
        return False


def unschedule_workflow(workflow_id: str) -> None:
    """Remove the scheduled job for a workflow (idempotent)."""
    if _scheduler is None:
        return
    job_id = f"workflow_{workflow_id}"
    try:
        _scheduler.remove_job(job_id)
        logger.info("Unscheduled workflow %s", workflow_id)
    except Exception:
        pass  # job didn't exist — that's fine


def get_next_run_time(workflow_id: str) -> datetime | None:
    """Return the next scheduled fire time for a workflow, or None if not scheduled."""
    if _scheduler is None:
        return None
    job = _scheduler.get_job(f"workflow_{workflow_id}")
    if job is None:
        return None
    return job.next_run_time


# ── Startup loader ────────────────────────────────────────────────────────────

def load_scheduled_workflows() -> int:
    """
    Query the DB for all schedule-enabled workflows and register them.
    Called once on app startup so schedules survive server restarts.
    Returns the count of successfully registered jobs.
    """
    from app.database import SessionLocal
    from app.workflow.db_models import Workflow as WorkflowModel

    db = SessionLocal()
    count = 0
    try:
        workflows = (
            db.query(WorkflowModel)
            .filter(WorkflowModel.schedule_enabled.is_(True))
            .all()
        )
        for wf in workflows:
            trigger_data = (wf.workflow_json or {}).get("trigger", {})
            cron_expr = trigger_data.get("condition", "")
            tz = wf.schedule_timezone or "UTC"
            if register_workflow_schedule(wf.id, cron_expr, tz):
                count += 1
    finally:
        db.close()

    logger.info("Loaded %d scheduled workflow(s) from DB", count)
    return count


# ── Fire callback ────────────────────────────────────────────────────────────

def _fire_workflow(workflow_id: str) -> None:
    """Called by APScheduler at the scheduled time. Runs in a thread pool worker."""
    logger.info("Scheduler firing workflow %s", workflow_id)
    from app.database import SessionLocal
    from app.workflow.engine.execution_engine import run_scheduled_workflow

    db = SessionLocal()
    try:
        run_scheduled_workflow(db, workflow_id)
    except Exception as exc:
        logger.error("Scheduled run of workflow %s failed: %s", workflow_id, exc, exc_info=True)
    finally:
        db.close()
