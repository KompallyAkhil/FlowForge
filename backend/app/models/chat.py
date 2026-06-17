# =============================================================================
# models/chat.py — Pydantic schemas for the Aiden chat assistant
#
# Defines the request/response contract for POST /api/chat/send and the
# history endpoints. All models are pure Pydantic (no ORM mapping) because
# chat history lives in-memory, not in the database.
#
# ChatMessage  — a single turn: role ("user" | "assistant") + content string.
#                Used both in the session history list and as the unit passed
#                to the LLM as conversation context.
#
# ChatRequest  — the body of POST /api/chat/send. session_id groups messages
#                into a conversation. use_memory and use_tools are feature
#                flags that the api/chat.py handler checks before calling
#                memory_service and tools_service respectively.
#
# ChatResponse — the reply returned to the frontend. Includes the session_id
#                (so the caller doesn't have to track it), the AI reply text,
#                a list of tool_calls that were made (currently only
#                "datetime_info: ..."), and memory_snippets that were
#                injected as context for this turn.
#
# ChatHistory  — returned by GET /api/chat/history/{session_id}. Wraps the
#                in-memory message list for a given session.
# =============================================================================
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
