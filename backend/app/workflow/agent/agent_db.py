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
