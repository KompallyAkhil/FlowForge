# =============================================================================
# api/memory.py — In-memory session-scoped storage router
#
# Exposes CRUD endpoints for the Aiden chat assistant's short-term memory.
# Memory items are stored per session_id in a plain Python dict inside
# memory_service.py (not persisted to the database — process-scoped only).
#
# Endpoints:
#   POST   /api/memory/add                   → store a new memory item
#   POST   /api/memory/search                → keyword search over items in a session
#   GET    /api/memory/list/{session_id}     → list all items for a session
#   DELETE /api/memory/item/{session_id}/{id} → delete one item
#   DELETE /api/memory/clear/{session_id}    → remove all items for a session
#   GET    /api/memory/test                  → smoke test (add → search → delete)
#
# The search is a simple case-insensitive substring match against item content
# and tags — there is no vector/semantic search. This is intentional: it keeps
# the memory system dependency-free and fast enough for the small item counts
# (capped at MEMORY_MAX_ITEMS per session, default 100) expected in practice.
#
# This router is used indirectly by the chat endpoint: when use_memory=True,
# api/chat.py calls memory_service directly (not this router) to search for
# relevant snippets before each LLM call and to store each completed turn.
# =============================================================================
from fastapi import APIRouter, HTTPException
from app.models.memory import (
    MemoryAddRequest,
    MemorySearchRequest,
    MemorySearchResponse,
    MemoryListResponse,
    MemoryItem,
)
from app.services import memory_service

router = APIRouter()


@router.post("/add", response_model=MemoryItem)
def add_memory(req: MemoryAddRequest) -> MemoryItem:
    return memory_service.add(req.session_id, req.content, req.tags)


@router.post("/search", response_model=MemorySearchResponse)
def search_memory(req: MemorySearchRequest) -> MemorySearchResponse:
    results = memory_service.search(req.session_id, req.query, req.limit)
    return MemorySearchResponse(results=results, total=len(results))


@router.get("/list/{session_id}", response_model=MemoryListResponse)
def list_memory(session_id: str) -> MemoryListResponse:
    items = memory_service.list_all(session_id)
    return MemoryListResponse(session_id=session_id, items=items, total=len(items))


@router.delete("/item/{session_id}/{item_id}")
def delete_memory(session_id: str, item_id: str) -> dict:
    deleted = memory_service.delete(session_id, item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory item not found")
    return {"deleted": True, "item_id": item_id}


@router.delete("/clear/{session_id}")
def clear_memory(session_id: str) -> dict:
    count = memory_service.clear(session_id)
    return {"cleared": count, "session_id": session_id}


@router.get("/test")
def test_endpoint() -> dict:
    """Smoke test — add and retrieve a memory item."""
    item = memory_service.add("test-session", "Test memory content", ["test"])
    results = memory_service.search("test-session", "test", limit=1)
    memory_service.delete("test-session", item.id)
    return {"ok": True, "item_id": item.id, "found": len(results) > 0}
