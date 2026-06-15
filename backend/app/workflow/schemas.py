from pydantic import BaseModel, Field, ConfigDict
from typing import Any
from datetime import datetime


class TriggerSchema(BaseModel):
    type: str  # event | schedule | manual | webhook | cron — open to any trigger type
    source: str
    condition: str | None = None


class StepSchema(BaseModel):
    id: str
    name: str
    type: str = "action"
    integration: str   # gmail | slack | sheets | ai | generic | any registered integration
    action: str
    params: dict[str, Any] = {}
    description: str | None = None  # human-readable explanation of what this step does


class WorkflowDefinition(BaseModel):
    name: str
    trigger: TriggerSchema
    steps: list[StepSchema]
    explanation: str


class CreateWorkflowRequest(BaseModel):
    natural_language: str = Field(min_length=5, max_length=4000)


class UpdateWorkflowRequest(BaseModel):
    name: str | None = None
    workflow_json: WorkflowDefinition | None = None


class StepUpdateRequest(BaseModel):
    """Patch a single step in-place — all fields optional."""
    name: str | None = None
    integration: str | None = None
    action: str | None = None
    params: dict[str, Any] | None = None
    description: str | None = None


class StepAddRequest(BaseModel):
    """Append or insert a new step into the workflow."""
    name: str
    integration: str
    action: str
    params: dict[str, Any] = {}
    description: str | None = None
    insert_after: str | None = None  # step_id to insert after; None = append at end


class ApproveRequest(BaseModel):
    """Approve a workflow for execution."""
    execute: bool = True  # if True, start execution immediately after approval


class RejectRequest(BaseModel):
    reason: str | None = None


class ScheduleUpdateRequest(BaseModel):
    schedule_enabled: bool
    schedule_timezone: str = "UTC"


class WorkflowResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    original_input: str
    workflow_json: dict[str, Any]
    explanation: str
    status: str = "draft"  # draft | approved | rejected
    created_at: datetime
    updated_at: datetime
    schedule_enabled: bool = False
    schedule_timezone: str = "UTC"
    next_run: datetime | None = None  # injected from scheduler, not a DB column


class WorkflowVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workflow_id: str
    version_number: int
    name: str
    workflow_json: dict[str, Any]
    change_summary: str
    changed_fields: list[dict[str, Any]] | None
    created_at: datetime


class ExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workflow_id: str
    status: str
    current_step: int
    started_at: datetime | None
    completed_at: datetime | None
    error: str | None

    @property
    def duration_seconds(self) -> float | None:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None

    def model_post_init(self, __context: Any) -> None:
        pass

    def model_dump(self, **kwargs) -> dict:
        d = super().model_dump(**kwargs)
        d["duration_seconds"] = self.duration_seconds
        return d


class ExecuteRequest(BaseModel):
    """Optional body for /execute — omit to run from the beginning."""
    start_from_step: int = 0  # 0 = full run; N = skip steps 0..N-1



class ExecutionLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    execution_id: str
    step_index: int
    step_name: str
    integration: str
    action: str
    status: str
    input_data: dict[str, Any] | None
    output_data: dict[str, Any] | None
    error: str | None
    retry_count: int
    created_at: datetime
    updated_at: datetime | None = None
