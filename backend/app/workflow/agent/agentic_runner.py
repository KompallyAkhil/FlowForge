"""
LangGraph ReAct agent — true dynamic tool calling.

Unlike the static planner, this agent:
  • receives the user's query
  • dynamically decides which tools to call and in what order
  • adapts based on actual intermediate results
  • NEVER calls a tool the user didn't ask for (e.g. won't post to Slack if not asked)
"""

import json
import logging
from typing import Annotated, TypedDict

from langchain_core.messages import (
    SystemMessage,
    HumanMessage,
    AIMessage,
    ToolMessage,
    BaseMessage,
)
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from app.core.config import get_settings
from app.core.llm import get_langchain_llm
from app.prompts import AGENT_INTRO
from app.workflow.agent.tools import get_all_tools

logger = logging.getLogger(__name__)


def _build_agent_system_prompt(tools: list) -> str:
    """Build the agent system prompt dynamically from the tools currently registered."""
    from app.workflow.integrations.base import IntegrationRegistry

    # Group tool names by integration prefix (e.g. gmail_search_emails → gmail)
    groups: dict[str, list[str]] = {}
    for t in tools:
        prefix = t.name.split("_")[0]
        groups.setdefault(prefix, []).append(t.name)

    tool_lines = "\n".join(
        f"  {group}: {', '.join(sorted(names))}"
        for group, names in sorted(groups.items())
    )

    # Collect output-step gate keywords and strategy hints from each integration's spec
    specs = IntegrationRegistry.collect_planner_specs()
    output_keywords: list[str] = []
    strategy_parts: list[str] = []
    for spec in specs:
        output_keywords.extend(spec.get("output_keywords", []))
        hint = spec.get("agent_strategy")
        if hint:
            strategy_parts.append(hint)
    gate_examples = ", ".join(output_keywords) if output_keywords else "a specific output action"
    strategy = "\n".join(strategy_parts) if strategy_parts else "- Use the available tools as needed."

    return f"""{AGENT_INTRO}

AVAILABLE TOOLS:
{tool_lines}

STRICT RULES — follow these exactly:
1. ONLY call tools that are necessary to fulfill the user's EXACT request.
2. NEVER use output tools unless the user EXPLICITLY says: {gate_examples}.
3. Read/fetch/search/summarize tasks stop after processing — do NOT add output steps.
4. When the user asks for N items (e.g. "5 emails") process ALL N, one by one.
5. After all tools finish, write a clear final answer with every result in plain text.

TOOL STRATEGY:
{strategy}

FINAL ANSWER FORMAT:
Write a clean, structured response with all results. Use markdown for readability.
"""


# ── Agent state ───────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


# ── Build graph (one instance per run — tools are stateless) ──────────────────

def build_agent_graph():
    s = get_settings()
    tools = get_all_tools()
    tool_node = ToolNode(tools)

    llm = get_langchain_llm().bind_tools(tools)

    def agent_node(state: AgentState) -> dict:
        tool_rounds = sum(
            1 for m in state["messages"]
            if isinstance(m, AIMessage) and getattr(m, "tool_calls", None)
        )
        if tool_rounds >= s.max_agent_steps:
            return {
                "messages": [AIMessage(content=(
                    f"Reached the {s.max_agent_steps}-step limit. "
                    "Here is what was completed so far."
                ))]
            }
        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    def route(state: AgentState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", route, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    return graph.compile()


# ── Public run function ───────────────────────────────────────────────────────

async def run_agent(query: str, run_id: str) -> dict:
    """
    Run the LangGraph agent for a natural-language query.

    Returns:
        {
          "run_id":       str,
          "status":       "success" | "failed",
          "final_answer": str | None,
          "steps":        list[dict],   # one entry per tool call
          "error":        str | None,
        }
    """
    steps: list[dict] = []

    try:
        tools = get_all_tools()
        agent = build_agent_graph()

        initial: AgentState = {
            "messages": [
                SystemMessage(content=_build_agent_system_prompt(tools)),
                HumanMessage(content=query),
            ]
        }

        logger.info("Agent run %s starting for query: %s", run_id, query[:80])
        final_state: AgentState = await agent.ainvoke(initial)

        # ── Parse message history into steps ─────────────────────────────────
        step_index = 0
        pending: dict[str, dict] = {}   # tool_call_id → step dict

        for msg in final_state["messages"]:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for tc in msg.tool_calls:
                    step = {
                        "step_index": step_index,
                        "tool_name":  tc["name"],
                        "tool_input": tc.get("args", {}),
                        "tool_output": None,
                        "status":     "success",  # updated below if ToolMessage fails
                    }
                    steps.append(step)
                    pending[tc["id"]] = step
                    step_index += 1

            elif isinstance(msg, ToolMessage):
                step = pending.get(msg.tool_call_id)
                if step:
                    try:
                        step["tool_output"] = json.loads(msg.content)
                    except Exception:
                        step["tool_output"] = {"raw": msg.content}
                    # ToolMessage with an error string → mark failed
                    if isinstance(msg.content, str) and msg.content.startswith('{"error"'):
                        step["status"] = "failed"

        # ── Extract final answer (last AIMessage with no tool_calls) ──────────
        final_answer = ""
        for msg in reversed(final_state["messages"]):
            if isinstance(msg, AIMessage) and msg.content and not msg.tool_calls:
                final_answer = msg.content
                break

        logger.info(
            "Agent run %s completed: %d tool calls, %d chars in final answer",
            run_id, len(steps), len(final_answer),
        )

        return {
            "run_id":       run_id,
            "status":       "success",
            "final_answer": final_answer,
            "steps":        steps,
            "error":        None,
        }

    except Exception as exc:
        logger.error("Agent run %s failed: %s", run_id, exc, exc_info=True)
        return {
            "run_id":       run_id,
            "status":       "failed",
            "final_answer": None,
            "steps":        steps,
            "error":        str(exc),
        }
