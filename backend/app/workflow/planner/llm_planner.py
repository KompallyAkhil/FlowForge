import json
import re
from app.core.config import get_settings
from app.prompts import (
    PLANNER_INTRO,
    PLANNER_OUTPUT_STEP_GATE,
    PLANNER_RESOURCE_RULES,
    PLANNER_GENERIC_INTEGRATION,
    PLANNER_CHAINING_RULES,
    PLANNER_TRIGGER_RULES,
    PLANNER_OUTPUT_FORMAT,
)
from app.workflow.schemas import WorkflowDefinition


def _allowed_integrations() -> set[str]:
    from app.workflow.integrations.base import IntegrationRegistry
    return set(IntegrationRegistry.list_all())


def _build_system_prompt() -> str:
    import json as _json
    from datetime import datetime, UTC
    from app.workflow.integrations.base import IntegrationRegistry

    now = datetime.now(UTC)
    current_date     = now.strftime("%Y-%m-%d")
    current_datetime = now.strftime("%Y-%m-%d %H:%M UTC")
    current_day      = now.strftime("%A")

    specs = IntegrationRegistry.collect_planner_specs()
    known_names = "/".join(spec["name"] for spec in specs)

    # Configured resources — collected dynamically from each integration
    resource_pairs = IntegrationRegistry.collect_configured_resources()
    resource_lines = [f"  • {label} : {value}" for label, value in resource_pairs]
    if not resource_lines:
        resource_lines.append("  (none — ask the user if a specific resource is required)")
    configured_resources = "\n".join(resource_lines)

    # Available integrations (dynamic — built from registry)
    int_lines = [f"- {spec['name']:<8}→ {spec['use_case']}" for spec in specs]
    int_lines.append("- generic → ANY other step (CRM, database, API call, webhook, custom business logic, manual task)")
    available_integrations = "\n".join(int_lines)

    # Known actions catalog (dynamic — built from each integration's planner spec)
    action_lines: list[str] = []
    for spec in specs:
        for action in spec["actions"]:
            action_lines.append(f"- {spec['name']}.{action['name']}:  {_json.dumps(action['params'])}")
    known_actions = "\n".join(action_lines)

    # Step output chaining examples (dynamic — built from specs that declare outputs)
    chaining_lines: list[str] = []
    for spec in specs:
        for action in spec["actions"]:
            if action.get("output") is not None:
                chaining_lines.append(f"- {spec['name']}.{action['name']} returns: {_json.dumps(action['output'])}")
                if action.get("output_note"):
                    chaining_lines.append(f"  {action['output_note']}")
    chaining_lines.append('- generic steps return:  {"status": "manual_required", "action": "...", "description": "..."}')
    chaining_lines.append('  → or if webhook:       {"status": "webhook_called", "action": "...", "response": {...}}')
    output_chaining = "\n".join(chaining_lines)

    # Static sections come from prompts.py — edit there to tune behavior
    return (
        f"{PLANNER_INTRO}\n\n"
        f"CURRENT DATE/TIME: {current_datetime} ({current_day})\n"
        f"  • When the user says 'today', 'now', or 'current date' use: {current_date}\n"
        f"  • Always write dates as ISO strings: YYYY-MM-DD\n\n"
        f"STRICT RULES:\n"
        f"1. Output ONLY valid JSON — no markdown, no explanation outside the JSON object\n"
        f"2. Use EXACTLY the param formats shown below — do not invent param names\n"
        f"3. For any step that does not map to {known_names}, use integration \"generic\"\n\n"
        f"AVAILABLE INTEGRATIONS AND WHEN TO USE THEM:\n{available_integrations}\n\n"
        f"CONFIGURED RESOURCES — use these exact values when the user does not specify:\n{configured_resources}\n\n"
        f"{PLANNER_OUTPUT_STEP_GATE}\n\n"
        f"{PLANNER_RESOURCE_RULES}\n\n"
        f"KNOWN INTEGRATION ACTIONS AND PARAMS:\n{known_actions}\n\n"
        f"{PLANNER_GENERIC_INTEGRATION}\n\n"
        f"STEP OUTPUT CHAINING — use ${{step_N.field}} to pass outputs between steps:\n"
        f"  N is 1-based and refers to the step that PRODUCES the output, not the step using it.\n"
        f"  Wrong: sheets step at position 4 writing ${{step_4.summary}} (self-reference — always a bug).\n"
        f"  Correct: sheets step at position 4 writing ${{step_3.summary}} (step 3 produced the summary).\n"
        f"{output_chaining}\n\n"
        f"{PLANNER_CHAINING_RULES}\n\n"
        f"{PLANNER_TRIGGER_RULES}\n\n"
        f"{PLANNER_OUTPUT_FORMAT}"
    )


async def plan_workflow(natural_language: str) -> WorkflowDefinition:
    settings = get_settings()
    if settings.ai_provider == "openrouter":
        return await _call_openrouter(natural_language)
    if settings.ai_provider == "groq":
        return await _call_groq(natural_language)
    return await _call_anthropic(natural_language)


def _parse_llm_output(raw: str) -> WorkflowDefinition:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
    raw = re.sub(r"\n?```\s*$", "", raw)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM returned invalid JSON: {exc}\n\nRaw output:\n{raw}") from exc

    allowed = _allowed_integrations()
    for step in data.get("steps", []):
        integration = step.get("integration", "")
        # Strip integration prefix from action if LLM includes it (e.g. "gmail.search_emails" → "search_emails")
        action = step.get("action", "")
        prefix = integration + "."
        if action.startswith(prefix):
            step["action"] = action[len(prefix):]
        # Unknown integrations are routed through generic
        if integration not in allowed:
            step["integration"] = "generic"
            if "description" not in step.get("params", {}):
                step.setdefault("params", {})["description"] = (
                    f"{integration}.{step['action']} — routed as generic step"
                )

    from pydantic import ValidationError
    try:
        return WorkflowDefinition(**data)
    except ValidationError as exc:
        raise ValueError(f"LLM output failed schema validation: {exc}") from exc


async def _call_openrouter(natural_language: str) -> WorkflowDefinition:
    from openai import AsyncOpenAI
    s = get_settings()
    client = AsyncOpenAI(api_key=s.openrouter_api_key, base_url=s.openrouter_base_url)

    response = await client.chat.completions.create(
        model=s.openrouter_model,
        max_tokens=s.planner_max_tokens,
        messages=[
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": natural_language},
        ],
    )
    raw = response.choices[0].message.content or ""
    return _parse_llm_output(raw)


async def _call_groq(natural_language: str) -> WorkflowDefinition:
    from groq import AsyncGroq
    s = get_settings()
    client = AsyncGroq(api_key=s.groq_api_key)

    response = await client.chat.completions.create(
        model=s.groq_model,
        max_tokens=s.planner_max_tokens,
        messages=[
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": natural_language},
        ],
    )

    raw = response.choices[0].message.content or ""
    return _parse_llm_output(raw)


async def _call_anthropic(natural_language: str) -> WorkflowDefinition:
    import anthropic
    s = get_settings()
    client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key)

    response = await client.messages.create(
        model=s.ai_model,
        max_tokens=s.planner_max_tokens,
        system=_build_system_prompt(),
        messages=[{"role": "user", "content": natural_language}],
    )

    raw = response.content[0].text or ""
    return _parse_llm_output(raw)
