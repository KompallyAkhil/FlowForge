from pydantic import BaseModel, Field
from typing import Literal
from datetime import datetime, UTC


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=32000)


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=32000)
    use_memory: bool = True
    use_tools: bool = True


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    tool_calls: list[str] = []
    memory_snippets: list[str] = []
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ChatHistory(BaseModel):
    session_id: str
    messages: list[ChatMessage] = []
