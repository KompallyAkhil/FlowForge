# =============================================================================
# api/chat.py — FlowForge general-purpose chat assistant router
#
# Provides a multi-turn conversational interface for the FlowForge assistant.
# This is separate from the workflow-specific chat endpoints — it is a
# general-purpose assistant that can answer questions about FlowForge,
# help users design workflows, and discuss automation ideas.
#
# Endpoints:
#   POST /api/chat/send          → send a message; returns AI reply
#   GET  /api/chat/history/{id}  → fetch conversation history for a session
#   DELETE /api/chat/history/{id} → clear a session's history
#   GET  /api/chat/test          → smoke test that exercises the full pipeline
#
# How a message is processed (send_message):
#   1. Append the user message to in-memory session history (_sessions dict).
#   2. If use_memory=True, call memory_service.search() for relevant past
#      snippets to include as context (top 3 hits).
#   3. If use_tools=True and the message mentions time/date keywords,
#      call tools_service.call_tool("datetime_info") and include the result.
#   4. Pass history + memory snippets + tool results to ai_service.generate_reply().
#   5. Append the assistant reply to session history.
#   6. If use_memory=True, store the turn (user msg + reply) in memory.
#
# Session state is stored in a plain Python dict (_sessions) — it is
# process-scoped and not persisted to the database. Restarting the server
# clears all session histories.
# =============================================================================
from fastapi import APIRouter, HTTPException
from app.models.chat import ChatRequest, ChatResponse, ChatHistory, ChatMessage
from app.services import ai_service, memory_service, tools_service

router = APIRouter()

# In-memory session store: session_id -> list[ChatMessage]
_sessions: dict[str, list[ChatMessage]] = {}


@router.post("/send", response_model=ChatResponse)
async def send_message(req: ChatRequest) -> ChatResponse:
    history = _sessions.setdefault(req.session_id, [])
    history.append(ChatMessage(role="user", content=req.message))

    memory_snippets: list[str] = []
    if req.use_memory:
        hits = memory_service.search(req.session_id, req.message, limit=3)
        memory_snippets = [h.content for h in hits]

    tool_calls: list[str] = []
    if req.use_tools and _should_use_tool(req.message):
        result = tools_service.call_tool("datetime_info")
        if result.success:
            tool_calls.append(f"datetime_info: {result.result}")

    reply = await ai_service.generate_reply(
        session_id=req.session_id,
        messages=history,
        memory_snippets=memory_snippets,
        tool_results=tool_calls,
    )

    history.append(ChatMessage(role="assistant", content=reply))

    if req.use_memory:
        memory_service.add(req.session_id, f"User: {req.message}\nAiden: {reply}")

    return ChatResponse(
        session_id=req.session_id,
        reply=reply,
        tool_calls=tool_calls,
        memory_snippets=memory_snippets,
    )


@router.get("/history/{session_id}", response_model=ChatHistory)
def get_history(session_id: str) -> ChatHistory:
    return ChatHistory(
        session_id=session_id,
        messages=_sessions.get(session_id, []),
    )


@router.delete("/history/{session_id}")
def clear_history(session_id: str) -> dict:
    _sessions.pop(session_id, None)
    return {"cleared": True, "session_id": session_id}


@router.get("/test")
async def test_endpoint() -> dict:
    """Smoke test — sends a fixed message through the full pipeline."""
    req = ChatRequest(session_id="test-session", message="Hello Aiden!", use_memory=False, use_tools=False)
    response = await send_message(req)
    return {"ok": True, "reply_preview": response.reply[:100]}


def _should_use_tool(message: str) -> bool:
    triggers = ["time", "date", "today", "now", "current"]
    return any(t in message.lower() for t in triggers)
