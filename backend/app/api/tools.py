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
