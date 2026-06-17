# =============================================================================
# services/ai_service.py — Async LLM reply generator for the chat assistant
#
# Contains the single async function `generate_reply` used by api/chat.py
# to produce Aiden's response to a user message.
#
# generate_reply(session_id, messages, memory_snippets, tool_results)
#   Builds the full system prompt by combining:
#     1. CHAT_ASSISTANT_SYSTEM — the base persona/role prompt from prompts.py
#     2. Relevant memory snippets (if any) injected as a "Relevant memory:"
#        block so the LLM can reference past context.
#     3. Tool results (if any) injected as a "Tool results:" block — e.g.,
#        the current datetime from tools_service.
#   Then calls the configured AI provider (openrouter / groq / anthropic)
#   with the full conversation history (all prior messages in the session)
#   and returns the assistant's text reply.
#
# _build_system(memory_snippets, tool_results)
#   Internal helper that assembles the system prompt string from the three
#   parts above. Returns a single string with sections separated by blank
#   lines so the LLM sees them as distinct blocks of context.
#
# This service is async because the LLM calls use async HTTP clients
# (AsyncOpenAI, AsyncGroq, AsyncAnthropic) which integrate cleanly with
# FastAPI's async request handlers without blocking the event loop.
# =============================================================================
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
