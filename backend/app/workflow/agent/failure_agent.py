# =============================================================================
# workflow/agent/failure_agent.py — LangGraph step-failure recovery agent
#
# Layer 4 of the execution engine's 4-layer recovery system. Invoked by
# execution_engine.run_execution() when a step has failed after all retries
# and the integration-level recovery agents have also failed.
#
# This is a separate, more powerful agent than the inline recovery agent in
# base.py. It has three tools available:
#
#   inspect_previous_outputs()
#     Returns a JSON dump of all successful step outputs from earlier in the
#     workflow run. The agent calls this to find the correct field names and
#     values that should be passed to the failed step (e.g. the real email ID,
#     the correct spreadsheet row, the actual channel ID).
#
#   get_config_defaults()
#     Returns the system's configured resources (Slack channel, spreadsheet ID,
#     sheet tab name) from IntegrationRegistry.collect_configured_resources().
#     Called when the step failed because a resource name is wrong or missing.
#
#   try_execute_step(params)
#     Re-executes the failed step by calling integration._dispatch() directly
#     (NOT .execute() — avoids re-triggering the integration-level recovery
#     agent and creating an infinite loop). Returns {"success": bool, "output"}.
#
# build_agent(step_integration, step_action, step_outputs) → compiled graph
#   Builds a fresh LangGraph StateGraph per failure. The graph has the same
#   agent→tools→agent loop as agentic_runner.py but with these three tools
#   and exits as soon as try_execute_step returns success=True.
#   Max attempts is controlled by settings.max_fix_attempts (default 2).
#
# run_failure_agent(step_integration, step_action, step_name, original_params,
#                   error_message, step_outputs) → {"fixed", "output", "error"}
#   Public entry point called by execution_engine.py.
#   Skips agent invocation entirely for rate-limit errors (they can't be fixed
#   by calling the same LLM that is itself rate-limited).
#   Returns {"fixed": True, "output": {...}} on success, or
#   {"fixed": False, "error": "..."} with the agent's explanation on failure.
# =============================================================================

import json
import logging
from typing import TypedDict, Annotated, Optional

from langchain_core.messages import (
    SystemMessage,
    HumanMessage,
    AIMessage,
    ToolMessage,
    BaseMessage,
)
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from app.core.config import get_settings
from app.core.llm import get_langchain_llm
from app.prompts import FAILURE_AGENT_SYSTEM
from app.workflow.integrations.base import IntegrationRegistry

logger = logging.getLogger(__name__)


# ── State ─────────────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


# ── Graph builder ─────────────────────────────────────────────────────────────

def _truncate_outputs(step_outputs: dict) -> str:
    """Summarize step outputs to fit in the context window."""
    trimmed: dict = {}
    for step_idx, output in step_outputs.items():
        if not isinstance(output, dict):
            trimmed[step_idx] = output
            continue
        step_trimmed: dict = {}
        for field, val in list(output.items())[:30]:
            if isinstance(val, list):
                step_trimmed[field] = val[:5]  # first 5 items
            elif isinstance(val, str) and len(val) > 300:
                step_trimmed[field] = val[:300] + "…"
            else:
                step_trimmed[field] = val
        trimmed[step_idx] = step_trimmed
    return json.dumps(trimmed, indent=2, default=str)[:5000]


def build_agent(step_integration: str, step_action: str, step_outputs: dict):
    settings = get_settings()
    outputs_summary = _truncate_outputs(step_outputs)

    @tool
    def inspect_previous_outputs() -> str:
        """
        Get the actual data returned by all previous workflow steps.
        Use this to find the correct field names and values to pass to the failed step.
        """
        return outputs_summary

    @tool
    def get_config_defaults() -> str:
        """
        Get the system's configured default resources.
        Call this when the step failed because a resource name is wrong or missing
        (e.g. Slack channel not found, wrong sheet name).
        Returns the actual configured values to use as replacements.
        """
        from app.workflow.integrations.base import IntegrationRegistry
        pairs = IntegrationRegistry.collect_configured_resources()
        return json.dumps({label: value for label, value in pairs})

    @tool
    def try_execute_step(params: dict) -> str:
        """
        Execute the failed step with corrected parameters.

        Args:
            params: Dictionary of parameters to pass to the step.
                    Use actual values (strings, ints) — never template placeholders like ${step_1.field}.

        Returns:
            JSON string: {"success": true, "output": {...}}
                      or {"success": false, "error": "..."}
        """
        try:
            integration = IntegrationRegistry.get(step_integration)
            # Call _dispatch() directly to avoid re-triggering the integration-level
            # recovery agent — this agent IS the recovery; nesting would cause a loop.
            output = integration._dispatch(step_action, params)
            return json.dumps({"success": True, "output": output}, default=str)
        except Exception as exc:
            return json.dumps({"success": False, "error": str(exc)})

    tools = [inspect_previous_outputs, get_config_defaults, try_execute_step]
    tool_node = ToolNode(tools)

    llm = get_langchain_llm().bind_tools(tools)

    def agent_node(state: AgentState) -> dict:
        # Count how many times we already called try_execute_step
        attempt_count = sum(
            1 for m in state["messages"]
            if isinstance(m, ToolMessage) and getattr(m, "name", "") == "try_execute_step"
        )

        if attempt_count >= settings.max_fix_attempts:
            # Force-stop: return a plain message with no tool calls
            return {
                "messages": [
                    AIMessage(
                        content=(
                            f"I've made {attempt_count} fix attempts without success. "
                            "This failure requires human intervention."
                        )
                    )
                ]
            }

        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    def route_after_agent(state: AgentState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    def route_after_tools(state: AgentState) -> str:
        """If try_execute_step just succeeded, we're done. Otherwise loop back."""
        for msg in reversed(state["messages"]):
            if not isinstance(msg, ToolMessage):
                break
            if getattr(msg, "name", "") == "try_execute_step":
                try:
                    result = json.loads(msg.content)
                    if result.get("success"):
                        return END
                except Exception as e:
                    logger.warning("Could not parse try_execute_step result as JSON: %s", e)
        return "agent"

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)

    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", route_after_agent, {"tools": "tools", END: END})
    graph.add_conditional_edges("tools", route_after_tools, {"agent": "agent", END: END})

    return graph.compile()


# ── Public API ────────────────────────────────────────────────────────────────

def run_failure_agent(
    step_integration: str,
    step_action: str,
    step_name: str,
    original_params: dict,
    error_message: str,
    step_outputs: dict,
) -> dict:
    """
    Run the LangGraph failure recovery agent for a single failed step.

    Returns:
        {
          "fixed":  bool,
          "output": dict | None,   # step output if fixed
          "error":  str,           # agent's explanation if not fixed
        }
    """
    # Rate-limit errors can't be fixed by an agent that also calls the same LLM.
    # Fail fast with the clear provider message so the user sees the real reason.
    _RL_SIGNALS = ("rate_limit_exceeded", "rate limit", "429", "tokens per day", "token quota",
                   "quota resets", "retry after")
    if any(sig in error_message.lower() for sig in _RL_SIGNALS):
        logger.info("Failure agent skipped for step '%s' — rate limit error", step_name)
        return {"fixed": False, "output": None, "error": error_message}

    try:
        agent = build_agent(step_integration, step_action, step_outputs)

        initial_state: AgentState = {
            "messages": [
                SystemMessage(content=FAILURE_AGENT_SYSTEM),
                HumanMessage(content=(
                    f"Step '{step_name}' failed.\n"
                    f"Integration : {step_integration}\n"
                    f"Action      : {step_action}\n"
                    f"Params used : {json.dumps(original_params, indent=2, default=str)}\n"
                    f"Error       : {error_message}\n\n"
                    "Please diagnose and fix this step."
                )),
            ]
        }

        logger.info(
            "Failure agent started for step '%s' (%s.%s)",
            step_name, step_integration, step_action,
        )

        final_state = agent.invoke(initial_state)

        # ── Check messages for a successful try_execute_step ──────────────
        for msg in reversed(final_state["messages"]):
            if isinstance(msg, ToolMessage) and getattr(msg, "name", "") == "try_execute_step":
                try:
                    result = json.loads(msg.content)
                    if result.get("success"):
                        logger.info("Failure agent fixed step '%s'", step_name)
                        return {
                            "fixed": True,
                            "output": result["output"],
                            "error": None,
                        }
                except Exception as e:
                    logger.warning("Could not parse agent tool result for step '%s': %s", step_name, e)

        # ── Extract agent's last text explanation ─────────────────────────
        explanation = ""
        for msg in reversed(final_state["messages"]):
            if isinstance(msg, AIMessage) and msg.content:
                explanation = msg.content
                break

        logger.warning(
            "Failure agent could not fix step '%s': %s",
            step_name, explanation or error_message,
        )
        return {
            "fixed": False,
            "output": None,
            "error": f"[Agent] {explanation}" if explanation else error_message,
        }

    except Exception as exc:
        logger.error("Failure agent crashed for step '%s': %s", step_name, exc, exc_info=True)
        return {"fixed": False, "output": None, "error": error_message}
