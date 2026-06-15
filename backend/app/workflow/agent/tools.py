"""
Dynamic tool collection from IntegrationRegistry.

Tools are now owned by each integration class via get_agent_tools().
Adding a new integration and registering it in integrations/__init__.py
is the only step required — no changes needed here.
"""
from app.workflow.integrations.base import IntegrationRegistry


def get_all_tools() -> list:
    """Return all LangChain agent tools from every registered integration."""
    return IntegrationRegistry.collect_agent_tools()
