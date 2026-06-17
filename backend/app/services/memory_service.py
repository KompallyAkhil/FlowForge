# =============================================================================
# services/memory_service.py — In-memory session-scoped key-value store
#
# Implements simple short-term memory for the Aiden chat assistant. Items
# are stored in a module-level dict (_store) keyed by session_id — this is
# purely in-process and is lost when the server restarts.
#
# Public API:
#   add(session_id, content, tags)  → creates a MemoryItem with a UUID,
#                                     appends it to the session's bucket,
#                                     and evicts the oldest item if the
#                                     bucket exceeds MEMORY_MAX_ITEMS (100).
#
#   list_all(session_id)            → returns a copy of all items for the
#                                     session (newest at the end).
#
#   search(session_id, query, limit) → case-insensitive substring match
#                                     against item content and tags.
#                                     Returns up to `limit` matching items.
#                                     No vector/embedding search — intentionally
#                                     simple to stay dependency-free.
#
#   delete(session_id, item_id)     → removes one item by UUID. Returns True
#                                     if deleted, False if not found.
#
#   clear(session_id)               → removes all items; returns the count.
#
# Called by:
#   - api/memory.py   → exposes these functions via REST endpoints
#   - api/chat.py     → searches before each LLM call, stores after each turn
# =============================================================================
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
