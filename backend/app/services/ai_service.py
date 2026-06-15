from app.core.config import get_settings
from app.models.chat import ChatMessage
from app.prompts import CHAT_ASSISTANT_SYSTEM


def _build_system(memory_snippets: list[str], tool_results: list[str]) -> str:
    parts = [CHAT_ASSISTANT_SYSTEM]
    if memory_snippets:
        parts.append("Relevant memory:\n" + "\n".join(f"- {s}" for s in memory_snippets))
    if tool_results:
        parts.append("Tool results:\n" + "\n".join(tool_results))
    return "\n\n".join(parts)


async def generate_reply(
    session_id: str,
    messages: list[ChatMessage],
    memory_snippets: list[str] | None = None,
    tool_results: list[str] | None = None,
) -> str:
    s = get_settings()
    snippets = memory_snippets or []
    results = tool_results or []
    lc_messages = [{"role": m.role, "content": m.content} for m in messages]

    if s.ai_provider == "openrouter":
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=s.openrouter_api_key, base_url=s.openrouter_base_url)
        resp = await client.chat.completions.create(
            model=s.openrouter_model,
            max_tokens=2048,
            messages=[{"role": "system", "content": _build_system(snippets, results)}] + lc_messages,
        )
        return (resp.choices[0].message.content or "").strip()

    if s.ai_provider == "groq":
        from groq import AsyncGroq
        client = AsyncGroq(api_key=s.groq_api_key)
        resp = await client.chat.completions.create(
            model=s.groq_model,
            max_tokens=2048,
            messages=[{"role": "system", "content": _build_system(snippets, results)}] + lc_messages,
        )
        return (resp.choices[0].message.content or "").strip()

    import anthropic
    client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key)
    resp = await client.messages.create(
        model=s.ai_model,
        max_tokens=2048,
        system=_build_system(snippets, results),
        messages=lc_messages,
    )
    return resp.content[0].text
