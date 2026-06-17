# =============================================================================
# models/memory.py — Pydantic schemas for the in-memory session storage
#
# Defines the data shapes used by api/memory.py and services/memory_service.py.
# These are not ORM models — memory items are stored in a plain Python dict
# inside memory_service.py, not in the SQLite database.
#
# MemoryItem         — a stored memory entry. Has a UUID id, the session it
#                      belongs to, free-text content (up to 4000 chars),
#                      an optional list of string tags for search filtering,
#                      and a UTC creation timestamp.
#
# MemoryAddRequest   — POST /api/memory/add body. Requires session_id and
#                      content; tags are optional.
#
# MemorySearchRequest — POST /api/memory/search body. Performs a keyword
#                       search within a session. limit defaults to 5 (max 20).
#
# MemorySearchResponse — wraps the search results list with a total count.
#
# MemoryListResponse — wraps the full item list for GET /api/memory/list/{id}
#                      with session_id and total count.
# =============================================================================
from pydantic import BaseModel, Field
from datetime import datetime, UTC


class MemoryItem(BaseModel):
    id: str
    session_id: str
    content: str = Field(min_length=1, max_length=4000)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    tags: list[str] = []


class MemoryAddRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=4000)
    tags: list[str] = []


class MemorySearchRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    query: str = Field(min_length=1, max_length=512)
    limit: int = Field(default=5, ge=1, le=20)


class MemorySearchResponse(BaseModel):
    results: list[MemoryItem]
    total: int


class MemoryListResponse(BaseModel):
    session_id: str
    items: list[MemoryItem]
    total: int
