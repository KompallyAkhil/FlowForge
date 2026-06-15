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
