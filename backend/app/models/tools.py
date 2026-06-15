from pydantic import BaseModel
from typing import Any, Literal

ToolName = Literal["datetime_info"]


class ToolCallResponse(BaseModel):
    tool: ToolName
    success: bool
    result: Any
    error: str | None = None
