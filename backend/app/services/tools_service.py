# =============================================================================
# services/tools_service.py — Tool dispatcher for the chat assistant
#
# Implements the backend side of the pluggable tool system used by the Aiden
# general-purpose chat assistant (api/chat.py). Not to be confused with the
# integration adapters in workflow/integrations/ — those are used by the
# workflow execution engine; this service is for the standalone chat UI.
#
# call_tool(tool_name, params)
#   The single public entry point. Calls _dispatch() in a try/except and
#   wraps the result in a ToolCallResponse(success=True/False). Callers
#   never need to handle exceptions — a failed tool always returns a
#   response with success=False and an error message.
#
# _dispatch(tool_name)
#   The routing table. Currently supports one tool:
#     "datetime_info" → returns {"utc": ISO timestamp, "day": "Monday", "date": "YYYY-MM-DD"}
#   Raises ValueError for unknown tool names.
#
# To add a new tool:
#   1. Add its name to ToolName in models/tools.py.
#   2. Add an elif branch in _dispatch() with the implementation.
#   No other files need to change.
# =============================================================================
from datetime import datetime, timezone
from app.models.tools import ToolCallResponse, ToolName


def call_tool(tool: ToolName) -> ToolCallResponse:
    try:
        result = _dispatch(tool)
        return ToolCallResponse(tool=tool, success=True, result=result)
    except Exception as exc:
        return ToolCallResponse(tool=tool, success=False, result=None, error=str(exc))


def _dispatch(tool: ToolName):
    if tool == "datetime_info":
        now = datetime.now(timezone.utc)
        return {"utc": now.isoformat(), "day": now.strftime("%A"), "date": now.strftime("%Y-%m-%d")}
    raise ValueError(f"Unknown tool: {tool}")
