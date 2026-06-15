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
