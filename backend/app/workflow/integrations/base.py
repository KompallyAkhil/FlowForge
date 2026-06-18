# =============================================================================
# workflow/integrations/base.py — Integration base class and plugin registry
#
# Two things live here: the abstract base class for all integrations, and the
# IntegrationRegistry that tracks which adapters are active.
#
# BaseIntegration (ABC)
#   Every integration adapter (gmail, slack, sheets, ai, generic) inherits
#   from this class. Subclasses MUST implement:
#     _dispatch(action, params) → dict
#       Routes an action string to the correct method (e.g. "send_message"
#       calls the Slack send logic). Raises ValueError for unknown actions.
#
#   Subclasses MAY override for integration-specific behavior:
#     _classify_error(exc)      → ErrorCategory  (FIXABLE|RATE_LIMIT|AUTH|FATAL|UNKNOWN)
#     _recover_fixable(...)     → pure-Python self-fix for FIXABLE errors
#     _get_recovery_tools()     → @tool functions for the inline recovery agent
#     get_agent_tools()         → @tool functions exposed to the main ReAct agent
#     get_configured_resources() → (label, value) pairs for the planner prompt
#     get_planner_spec()        → structured spec used to build the planner prompt
#
#   The public entry point is execute(action, params) which calls _dispatch()
#   and routes any exception through the 2-layer recovery system:
#     1. _recover_fixable() — fast, no LLM cost
#     2. _run_recovery_agent() — inline LangGraph StateGraph scoped to this adapter
#
#   _run_recovery_agent() builds a mini LangGraph graph on the fly with:
#     - retry_action tool (always present) — retries _dispatch with new params
#     - integration-specific discovery tools from _get_recovery_tools()
#   It exits as soon as retry_action succeeds or max_fix_attempts is reached.
#
# IntegrationRegistry (plugin registry)
#   A class-level dict mapping integration name → BaseIntegration instance.
#   New integrations register themselves in workflow/integrations/__init__.py.
#   Provides:
#     register(name, integration) → add to registry
#     get(name)                   → raise KeyError if not found
#     collect_agent_tools()       → all tools from all integrations (for the main agent)
#     collect_planner_specs()     → all planner specs (for the system prompt builder)
#     collect_configured_resources() → all (label, value) pairs (for planner + agent)
#
# ErrorCategory (Enum)
#   FIXABLE    — wrong resource name, discoverable via Python
#   RATE_LIMIT — 429 / too many requests → exponential backoff
#   AUTH       — bad credentials → fail immediately, no retry
#   FATAL      — quota exceeded → fail immediately
#   UNKNOWN    — anything else → hand to recovery agent
# =============================================================================
import json
import logging
import time
from abc import ABC, abstractmethod
from enum import Enum, auto
from typing import Any, Annotated, TypedDict

logger = logging.getLogger(__name__)


class HumanInputRequired(Exception):
    """
    Raised by an integration's _recover_fixable when it cannot auto-fix the error
    and needs the user to decide (e.g. "Channel not found — create it?").

    The execution engine catches this, pauses the execution with status='waiting_input',
    and stores the question payload in Execution.pending_input so the frontend can show it.
    """
    def __init__(
        self,
        question: str,
        integration_name: str,
        resource_type: str,
        resource_name: str,
        extra: dict | None = None,
    ) -> None:
        super().__init__(question)
        self.question = question
        self.integration_name = integration_name
        self.resource_type = resource_type   # e.g. "channel", "sheet_tab"
        self.resource_name = resource_name   # e.g. "support", "Weight Tracking"
        self.extra = extra or {}


class ErrorCategory(Enum):
    FIXABLE    = auto()   # wrong resource name — discoverable and correctable via Python
    RATE_LIMIT = auto()   # too many requests — exponential backoff then retry
    AUTH       = auto()   # bad credentials — fail immediately, no retry
    FATAL      = auto()   # quota / account suspended — fail immediately
    UNKNOWN    = auto()   # anything else — hand to LangGraph recovery agent


class BaseIntegration(ABC):
    """
    Base class for all integrations.

    Subclasses MUST implement:
      _dispatch(action, params)       — route action string to the correct handler

    Subclasses MAY override:
      _classify_error(exc)            — map exceptions → ErrorCategory
      _recover_fixable(action, params, exc) — pure-Python fix for FIXABLE errors
      _get_recovery_tools()           — @tool-decorated discovery functions for the LangGraph agent
    """

    # ── Public entry point ─────────────────────────────────────────────────────

    def execute(self, action: str, params: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._dispatch(action, params)
        except Exception as exc:
            return self._handle_error(action, params, exc)

    # ── Subclass contract ──────────────────────────────────────────────────────

    @abstractmethod
    def _dispatch(self, action: str, params: dict[str, Any]) -> dict[str, Any]:
        """Route action to the correct handler. Raise ValueError for unknown actions."""

    def _classify_error(self, exc: Exception) -> ErrorCategory:
        """Override with integration-specific error classification. Default: UNKNOWN."""
        return ErrorCategory.UNKNOWN

    def _recover_fixable(self, action: str, params: dict, exc: Exception) -> dict:
        """
        Override for pure-Python recovery of FIXABLE errors (no LLM cost).
        Default: re-raise so the LangGraph agent takes over.
        """
        raise exc

    def _get_recovery_tools(self) -> list:
        """
        Return a list of @tool-decorated discovery functions the LangGraph agent can call.
        Override in subclasses to provide integration-specific discovery (list channels, list sheets, etc.).
        Default: empty — the agent only has retry_action.
        """
        return []

    def get_agent_tools(self) -> list:
        """
        Return LangChain @tool functions exposed to the LangGraph agent.
        Override in subclasses to make the integration's actions available to the agent.
        Default: empty — integration is not accessible to the agent.
        """
        return []

    def get_configured_resources(self) -> list[tuple[str, str]]:
        """
        Return (label, value) pairs for any pre-configured resources the planner should know about.
        Override in subclasses so the planner prompt dynamically reflects .env defaults.
        Default: empty — integration has no pre-configured defaults to surface.

        Example return: [("Slack default channel", "#ops"), ("Spreadsheet ID", "1BxiM...")]
        """
        return []

    def get_planner_spec(self) -> dict | None:
        """
        Return a structured spec used to build the workflow planner's system prompt dynamically.
        Override in subclasses so new integrations are automatically described to the LLM.
        Return None to exclude this integration from the planner prompt (e.g. generic).

        Expected shape:
            {
                "name": "gmail",
                "use_case": "sending/reading/searching emails",
                "output_keywords": ['"email me"', '"send an email"'],   # phrases that gate output steps
                "agent_strategy": "- Emails: search first, then read each ID",  # hint for agent prompt
                "actions": [
                    {
                        "name": "search_emails",
                        "params": {"query": "subject:invoice", "max_results": 5},
                        "output": {"emails": [...], "total": 1},   # None if not useful for chaining
                        "output_note": "→ To get first email ID: ${step_1.emails[0].id}",  # optional
                    },
                    ...
                ],
            }
        """
        return None

    def _recovery_system_prompt(self) -> str:
        from app.prompts import INTEGRATION_RECOVERY_SYSTEM
        return INTEGRATION_RECOVERY_SYSTEM

    # ── Error-handling orchestration ───────────────────────────────────────────

    def _handle_error(self, action: str, params: dict, exc: Exception) -> dict:
        category = self._classify_error(exc)
        name = self.__class__.__name__

        # Hard failures — no recovery possible
        if category in (ErrorCategory.AUTH, ErrorCategory.FATAL):
            logger.error("[%s] Permanent %s failure: %s", name, category.name, exc)
            raise exc

        # Rate-limited — exponential backoff
        if category == ErrorCategory.RATE_LIMIT:
            logger.warning("[%s] Rate limited — starting exponential backoff", name)
            return self._handle_rate_limit(action, params, exc)

        # Known fixable error — try pure-Python recovery first (fast, no LLM cost)
        if category == ErrorCategory.FIXABLE:
            logger.info("[%s] FIXABLE error — attempting Python recovery", name)
            try:
                return self._recover_fixable(action, params, exc)
            except HumanInputRequired:
                raise  # must bubble up to the execution engine — do not hand to LangGraph
            except Exception as fix_exc:
                logger.warning(
                    "[%s] Python recovery failed (%s) — escalating to LangGraph agent",
                    name, fix_exc,
                )
                exc = fix_exc  # use the latest exception for the agent's context

        # UNKNOWN or FIXABLE that Python couldn't fix → LangGraph recovery agent
        logger.info("[%s] Starting LangGraph recovery agent for action '%s'", name, action)
        return self._run_recovery_agent(action, params, exc)

    def _handle_rate_limit(self, action: str, params: dict, exc: Exception) -> dict:
        from app.core.config import get_settings
        s = get_settings()
        for attempt in range(1, s.max_execution_retries + 1):
            delay = 2 ** attempt          # 2s → 4s → 8s
            logger.info(
                "[%s] Backoff %ds (attempt %d/%d)",
                self.__class__.__name__, delay, attempt, s.max_execution_retries,
            )
            time.sleep(delay)
            try:
                return self._dispatch(action, params)
            except Exception as retry_exc:
                if attempt == s.max_execution_retries:
                    raise retry_exc
        raise exc

    # ── LangGraph recovery agent ───────────────────────────────────────────────

    def _run_recovery_agent(self, action: str, params: dict, exc: Exception) -> dict:
        from app.core.config import get_settings
        from app.core.llm import get_langchain_llm
        from langchain_core.tools import tool as lc_tool
        from langchain_core.messages import (
            SystemMessage, HumanMessage, AIMessage, ToolMessage, BaseMessage,
        )
        from langgraph.graph import StateGraph, END
        from langgraph.graph.message import add_messages
        from langgraph.prebuilt import ToolNode

        s = get_settings()
        _dispatch = self._dispatch   # closure — avoids holding a reference to self in the tool

        @lc_tool
        def retry_action(params: dict) -> str:
            """
            Retry the failed action with corrected parameters.

            Args:
                params: Dictionary of corrected parameters.
                        Use real values (strings, numbers) — never template placeholders.

            Returns:
                JSON: {"success": true, "output": {...}} on success,
                      {"success": false, "error": "..."} on failure.
            """
            try:
                output = _dispatch(action, params)
                return json.dumps({"success": True, "output": output}, default=str)
            except Exception as e:
                return json.dumps({"success": False, "error": str(e)})

        tools = [*self._get_recovery_tools(), retry_action]
        tool_node = ToolNode(tools)

        class _State(TypedDict):
            messages: Annotated[list[BaseMessage], add_messages]

        llm = get_langchain_llm().bind_tools(tools)

        def agent_node(state: _State) -> dict:
            retries_used = sum(
                1 for m in state["messages"]
                if isinstance(m, ToolMessage) and getattr(m, "name", "") == "retry_action"
            )
            if retries_used >= s.max_fix_attempts:
                return {
                    "messages": [
                        AIMessage(content=f"Exhausted {retries_used} recovery attempt(s). Cannot fix.")
                    ]
                }
            return {"messages": [llm.invoke(state["messages"])]}

        def route(state: _State) -> str:
            last = state["messages"][-1]
            return "tools" if (hasattr(last, "tool_calls") and last.tool_calls) else END

        def route_after_tools(state: _State) -> str:
            for msg in reversed(state["messages"]):
                if not isinstance(msg, ToolMessage):
                    break
                if getattr(msg, "name", "") == "retry_action":
                    try:
                        if json.loads(msg.content).get("success"):
                            return END
                    except Exception as e:
                        logger.warning("[%s] Could not parse retry_action result: %s", self.__class__.__name__, e)
            return "agent"

        graph = StateGraph(_State)
        graph.add_node("agent", agent_node)
        graph.add_node("tools", tool_node)
        graph.set_entry_point("agent")
        graph.add_conditional_edges("agent", route, {"tools": "tools", END: END})
        graph.add_conditional_edges("tools", route_after_tools, {"agent": "agent", END: END})
        compiled = graph.compile()

        initial: _State = {
            "messages": [
                SystemMessage(content=self._recovery_system_prompt()),
                HumanMessage(content=(
                    f"Action '{action}' failed.\n"
                    f"Error  : {exc}\n"
                    f"Params : {json.dumps(params, default=str)}\n\n"
                    "Diagnose the error, use discovery tools to find the correct values, "
                    "then call retry_action with corrected params."
                )),
            ]
        }

        final_state = compiled.invoke(initial)

        # Return the output from the last successful retry_action
        for msg in reversed(final_state["messages"]):
            if isinstance(msg, ToolMessage) and getattr(msg, "name", "") == "retry_action":
                try:
                    result = json.loads(msg.content)
                    if result.get("success"):
                        logger.info("[%s] LangGraph agent recovered action '%s'", self.__class__.__name__, action)
                        return result["output"]
                except Exception as e:
                    logger.warning("[%s] Could not parse recovery agent result for action '%s': %s", self.__class__.__name__, action, e)

        # Agent could not fix it — raise the original error
        raise exc


class IntegrationRegistry:
    """Plugin registry — add new integrations without touching core logic."""

    _registry: dict[str, BaseIntegration] = {}

    @classmethod
    def register(cls, name: str, integration: BaseIntegration) -> None:
        cls._registry[name] = integration

    @classmethod
    def get(cls, name: str) -> BaseIntegration:
        if name not in cls._registry:
            raise KeyError(f"Integration '{name}' is not registered. Available: {cls.list_all()}")
        return cls._registry[name]

    @classmethod
    def list_all(cls) -> list[str]:
        return sorted(cls._registry.keys())

    @classmethod
    def collect_agent_tools(cls) -> list:
        """Collect all LangChain agent tools from every registered integration."""
        tools = []
        for integration in cls._registry.values():
            tools.extend(integration.get_agent_tools())
        return tools

    @classmethod
    def collect_planner_specs(cls) -> list[dict]:
        """Collect planner specs from every registered integration (None returns are excluded)."""
        specs = []
        for integration in cls._registry.values():
            spec = integration.get_planner_spec()
            if spec is not None:
                specs.append(spec)
        return specs

    @classmethod
    def collect_configured_resources(cls) -> list[tuple[str, str]]:
        """Collect all (label, value) resource pairs from every registered integration."""
        resources: list[tuple[str, str]] = []
        for integration in cls._registry.values():
            resources.extend(integration.get_configured_resources())
        return resources
