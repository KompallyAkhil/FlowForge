import uuid
from datetime import datetime, UTC
from sqlalchemy import Boolean, Column, String, Integer, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.database import Base


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    original_input = Column(Text, nullable=False)
    workflow_json = Column(JSON, nullable=False)
    explanation = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

    # Lifecycle status — set by the review/approval flow
    status = Column(String, default="draft", nullable=False)  # draft | approved | rejected

    # Scheduling — cron expression lives in workflow_json.trigger.condition
    schedule_enabled = Column(Boolean, default=False, nullable=False)
    schedule_timezone = Column(String, default="UTC", nullable=False)

    executions = relationship("Execution", back_populates="workflow", cascade="all, delete-orphan")
    versions   = relationship(
        "WorkflowVersion",
        back_populates="workflow",
        cascade="all, delete-orphan",
        order_by="WorkflowVersion.version_number",
    )


class Execution(Base):
    __tablename__ = "executions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id = Column(String, ForeignKey("workflows.id"), nullable=False, index=True)
    status = Column(String, default="pending")  # pending | running | success | failed
    current_step = Column(Integer, default=0)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)

    workflow = relationship("Workflow", back_populates="executions")
    logs = relationship("ExecutionLog", back_populates="execution", cascade="all, delete-orphan")


class WorkflowVersion(Base):
    """Immutable snapshot of a workflow at each save point, plus a structured diff."""
    __tablename__ = "workflow_versions"

    id             = Column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id    = Column(String,  ForeignKey("workflows.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    name           = Column(String,  nullable=False)
    workflow_json  = Column(JSON,    nullable=False)
    change_summary = Column(Text,    nullable=False, default="Initial creation")
    changed_fields = Column(JSON,    nullable=True)
    created_at     = Column(DateTime, default=lambda: datetime.now(UTC))

    workflow = relationship("Workflow", back_populates="versions")


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    execution_id = Column(String, ForeignKey("executions.id"), nullable=False, index=True)
    step_index = Column(Integer, nullable=False)
    step_name = Column(String, nullable=False)
    integration = Column(String, nullable=False)
    action = Column(String, nullable=False)
    status = Column(String, nullable=False)  # success | failed | skipped
    input_data = Column(JSON, nullable=True)
    output_data = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, nullable=True, onupdate=lambda: datetime.now(UTC))

    execution = relationship("Execution", back_populates="logs")


class IntegrationCredential(Base):
    """Stores per-integration OAuth tokens / API keys connected via the setup screen."""
    __tablename__ = "integration_credentials"

    id             = Column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    integration    = Column(String,  nullable=False, unique=True)  # "gmail" | "slack" | "sheets"
    credential_data = Column(JSON,   nullable=False)
    status         = Column(String,  default="connected")          # "connected" | "error"
    connected_at   = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at     = Column(DateTime, default=lambda: datetime.now(UTC))
