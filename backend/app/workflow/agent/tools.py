# =============================================================================
# workflow/agent/tools.py — Dynamic tool collector for the ReAct agent
#
# A thin delegation layer that collects all LangChain @tool functions from
# every registered integration and returns them as a flat list.
#
# get_all_tools() → list
#   Calls IntegrationRegistry.collect_agent_tools() which iterates over every
#   registered integration adapter and calls get_agent_tools() on each one.
#   The result is a list of LangChain tool objects ready to be bound to the
#   LLM via .bind_tools(tools) in agentic_runner.py.
#
# Design: tools are owned by their integration adapters (gmail.py, slack.py,
# etc.) rather than being defined here. This means adding a new integration
# with its own agent tools only requires:
#   1. Implementing get_agent_tools() in the new adapter class.
#   2. Registering the adapter in workflow/integrations/__init__.py.
# No changes to this file or agentic_runner.py are needed.
# =============================================================================
from app.workflow.integrations.base import IntegrationRegistry


def get_all_tools() -> list:
    """Return all LangChain agent tools from every registered integration."""
    return IntegrationRegistry.collect_agent_tools()
