# =============================================================================
# core/llm.py — Shared LLM client factory
#
# The single place in the codebase where AI provider clients are constructed.
# All other modules that need to call an LLM import from here instead of
# instantiating provider clients directly.
#
# Two public functions:
#
# chat_complete(system, user, max_tokens)
#   Synchronous, single-turn completion. Used by the integration adapters
#   (ai_tools.py: summarize/extract/transform) where blocking is acceptable
#   because the execution engine already runs in a background thread.
#   Dispatches on settings.ai_provider and uses the matching SDK client.
#
# get_langchain_llm()
#   Returns a LangChain chat model instance (ChatOpenAI / ChatGroq /
#   ChatAnthropic) compatible with LangGraph's StateGraph.
#   Called by:
#     - agentic_runner.py   → main ReAct agent (free-form tool use)
#     - failure_agent.py    → step-level failure recovery agent
#     - base.py             → per-integration inline recovery agent
#   All three use .bind_tools(tools) on the returned object to enable
#   LangChain tool-calling.
#
# _AI_TIMEOUT (60s) is applied to every client to prevent a hung AI call
# from stalling a workflow execution indefinitely.
# =============================================================================
"""Shared LLM client factory — abstracts OpenRouter, Groq, and Anthropic."""
from app.core.config import get_settings


_AI_TIMEOUT = 60.0  # seconds — prevents AI steps from hanging forever


def chat_complete(system: str, user: str, max_tokens: int | None = None) -> str:
    """
    Synchronous chat completion using the configured AI provider.
    Returns the assistant's text response.
    """
    s = get_settings()
    tokens = max_tokens or s.ai_tools_max_tokens

    if s.ai_provider == "openrouter":
        from openai import OpenAI
        client = OpenAI(
            api_key=s.openrouter_api_key,
            base_url=s.openrouter_base_url,
            timeout=_AI_TIMEOUT,
        )
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        response = client.chat.completions.create(
            model=s.openrouter_model,
            max_tokens=tokens,
            messages=messages,
        )
        return (response.choices[0].message.content or "").strip()

    if s.ai_provider == "groq":
        from groq import Groq
        client = Groq(api_key=s.groq_api_key, timeout=_AI_TIMEOUT)
        response = client.chat.completions.create(
            model=s.groq_model,
            max_tokens=tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return response.choices[0].message.content.strip()

    import anthropic
    client = anthropic.Anthropic(api_key=s.anthropic_api_key, timeout=_AI_TIMEOUT)
    response = client.messages.create(
        model=s.ai_model,
        max_tokens=tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return response.content[0].text.strip()


def get_langchain_llm():
    """LangChain chat model for the configured AI provider (used by LangGraph agents)."""
    s = get_settings()

    if s.ai_provider == "openrouter":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            api_key=s.openrouter_api_key,
            base_url=s.openrouter_base_url,
            model=s.openrouter_model,
            temperature=s.llm_temperature,
            timeout=_AI_TIMEOUT,
        )

    if s.ai_provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(
            api_key=s.groq_api_key,
            model=s.groq_model,
            temperature=s.llm_temperature,
            request_timeout=_AI_TIMEOUT,
        )

    from langchain_anthropic import ChatAnthropic
    return ChatAnthropic(
        api_key=s.anthropic_api_key,
        model=s.ai_model,
        temperature=s.llm_temperature,
        default_request_timeout=_AI_TIMEOUT,
    )
