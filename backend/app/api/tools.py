# =============================================================================
# api/tools.py — Pluggable tool invocation router
#
# A thin HTTP layer over tools_service.py that lets external callers list and
# invoke backend tools by name. Currently the only registered tool is
# "datetime_info" which returns the current UTC date, time, and day of week.
#
# Endpoints:
#   GET  /api/tools/list  → list all available tool names
#   POST /api/tools/call  → call a tool by name with optional params
#   GET  /api/tools/test  → smoke test that calls all four tool stubs
#
# The test endpoint exercises four tool stubs (web_search, calculator,
# datetime_info, summarize) — only datetime_info is actually implemented;
# the others will return success=False in the response, which is expected
# and documented.
#
# This router is also used internally by api/chat.py: when a user message
# mentions time/date keywords, the chat endpoint calls
# tools_service.call_tool("datetime_info") directly (bypassing HTTP) to
# inject the current datetime into the LLM context before generating a reply.
# =============================================================================
from fastapi import APIRouter
from app.models.tools import ToolCallRequest, ToolCallResponse, ToolListResponse
from app.services import tools_service

router = APIRouter()


@router.get("/list", response_model=ToolListResponse)
def list_tools() -> ToolListResponse:
    return ToolListResponse(tools=tools_service.list_tools())


@router.post("/call", response_model=ToolCallResponse)
def call_tool(req: ToolCallRequest) -> ToolCallResponse:
    return tools_service.call_tool(req.tool, req.params)


@router.get("/test")
def test_endpoint() -> dict:
    """Smoke test — runs all four tools and reports success/failure."""
    cases = [
        ("web_search", {"query": "AI trends 2025"}),
        ("calculator", {"expression": "7 * 6"}),
        ("datetime_info", {}),
        ("summarize", {"text": "This is a test sentence that should be summarized."}),
    ]
    results = {}
    for tool, params in cases:
        r = tools_service.call_tool(tool, params)  # type: ignore[arg-type]
        results[tool] = {"success": r.success, "error": r.error}
    return {"ok": all(v["success"] for v in results.values()), "results": results}
