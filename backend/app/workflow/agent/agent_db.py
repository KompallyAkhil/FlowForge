# =============================================================================
# workflow/agent/agent_db.py — ORM models for the LangGraph ReAct agent
#
# Defines the two tables that persist the results of agentic runs. These are
# separate from the workflow execution tables (Execution, ExecutionLog) because
# the agent is a standalone feature — not tied to any Workflow record.
#
# AgentRun
#   One row per invocation of the ReAct agent (POST /api/agent/runs/).
#   Fields: id (UUID), query (the user's natural language request), status
#   (pending → running → success | failed), final_answer (the agent's last
#   text response after all tool calls complete), error (if failed), and
#   started_at / completed_at timestamps.
#   Has a cascading one-to-many relationship to AgentStep.
#
# AgentStep
#   One row per tool call made during a run. Fields: id, run_id (FK),
#   step_index (0-based order), tool_name, tool_input (JSON args), tool_output
#   (JSON result), status (success | failed), created_at.
#   The relationship is ordered by step_index so the frontend can display
#   the tool call sequence in the order they actually occurred.
#
# These models are imported by database.init_db() (via `from app.workflow.agent
# import agent_db`) to ensure their tables are created at startup alongside the
# workflow tables. They use the same Base from database.py.
# =============================================================================
from datetime import datetime, UTC
from sqlalchemy import Column, String, Integer, JSON, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id           = Column(String, primary_key=True)
    query        = Column(Text, nullable=False)
    status       = Column(String, default="pending")  # pending | running | success | failed
    final_answer = Column(Text, nullable=True)
    error        = Column(Text, nullable=True)
    started_at   = Column(DateTime, default=lambda: datetime.now(UTC))
    completed_at = Column(DateTime, nullable=True)

    steps = relationship(
        "AgentStep",
        back_populates="run",
        order_by="AgentStep.step_index",
        cascade="all, delete-orphan",
    )


class AgentStep(Base):
    __tablename__ = "agent_steps"

    id          = Column(String, primary_key=True)
    run_id      = Column(String, ForeignKey("agent_runs.id"), nullable=False, index=True)
    step_index  = Column(Integer, nullable=False)
    tool_name   = Column(String, nullable=False)
    tool_input  = Column(JSON, nullable=True)
    tool_output = Column(JSON, nullable=True)
    status      = Column(String, default="success")  # success | failed
    created_at  = Column(DateTime, default=lambda: datetime.now(UTC))

    run = relationship("AgentRun", back_populates="steps")
