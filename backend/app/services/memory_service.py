import uuid
from datetime import datetime, UTC
from app.models.memory import MemoryItem
from app.core.config import get_settings

settings = get_settings()

# In-memory store: session_id -> list[MemoryItem]
_store: dict[str, list[MemoryItem]] = {}


def add(session_id: str, content: str, tags: list[str] | None = None) -> MemoryItem:
    if tags is None:
        tags = []
    item = MemoryItem(
        id=str(uuid.uuid4()),
        session_id=session_id,
        content=content,
        tags=tags,
        created_at=datetime.now(UTC),
    )
    bucket = _store.setdefault(session_id, [])
    bucket.append(item)
    if len(bucket) > settings.memory_max_items:
        bucket.pop(0)
    return item


def list_all(session_id: str) -> list[MemoryItem]:
    return list(_store.get(session_id, []))


def search(session_id: str, query: str, limit: int = 5) -> list[MemoryItem]:
    q = query.lower()
    results = [
        item
        for item in _store.get(session_id, [])
        if q in item.content.lower() or any(q in t.lower() for t in item.tags)
    ]
    return results[:limit]


def delete(session_id: str, item_id: str) -> bool:
    bucket = _store.get(session_id, [])
    before = len(bucket)
    _store[session_id] = [i for i in bucket if i.id != item_id]
    return len(_store[session_id]) < before


def clear(session_id: str) -> int:
    count = len(_store.get(session_id, []))
    _store[session_id] = []
    return count
