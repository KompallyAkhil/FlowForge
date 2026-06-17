# =============================================================================
# models/tools.py — Pydantic schemas for the tool invocation system
#
# Defines the data contract for GET /api/tools/list and POST /api/tools/call.
#
# ToolName        — a Literal type alias that enumerates valid tool names.
#                   Currently only "datetime_info" is implemented. Adding a
#                   new tool requires adding its name here AND implementing
#                   its handler in services/tools_service.py._dispatch().
#
# ToolCallResponse — the standard response shape for any tool call:
#                    tool (name), success (bool), result (any JSON value),
#                    and an optional error string on failure.
#
# ToolCallRequest  — the body for POST /api/tools/call. Contains the tool
#                    name and an optional params dict passed to the handler.
#
# ToolListResponse — returned by GET /api/tools/list. Wraps the list of
#                    available tool name strings.
# =============================================================================
from pydantic import BaseModel
from typing import Any, Literal

ToolName = Literal["datetime_info"]


class ToolCallResponse(BaseModel):
    tool: ToolName
    success: bool
    result: Any
    error: str | None = None
