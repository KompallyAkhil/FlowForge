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
