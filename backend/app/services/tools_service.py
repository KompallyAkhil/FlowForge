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
