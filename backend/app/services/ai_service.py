from app.core.config import get_settings
from app.models.chat import ChatMessage
from app.prompts import CHAT_ASSISTANT_SYSTEM

settings = get_settings()


async def generate_reply(
    session_id: str,
    messages: list[ChatMessage],
    memory_snippets: list[str] | None = None,
    tool_results: list[str] | None = None,
) -> str:
    return await _anthropic_reply(
        session_id,
        messages,
        memory_snippets or [],
        tool_results or [],
    )


async def _anthropic_reply(
    session_id: str,
    messages: list[ChatMessage],
    memory_snippets: list[str],
    tool_results: list[str],
) -> str:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    system_parts = [CHAT_ASSISTANT_SYSTEM]
    if memory_snippets:
        system_parts.append("Relevant memory:\n" + "\n".join(f"- {s}" for s in memory_snippets))
    if tool_results:
        system_parts.append("Tool results:\n" + "\n".join(tool_results))

    response = await client.messages.create(
        model=settings.ai_model,
        max_tokens=2048,
        system="\n\n".join(system_parts),
        messages=[{"role": m.role, "content": m.content} for m in messages],
    )
    return response.content[0].text
