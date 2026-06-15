from app.workflow.integrations.base import IntegrationRegistry
from app.workflow.integrations.gmail import GmailIntegration
from app.workflow.integrations.slack import SlackIntegration
from app.workflow.integrations.sheets import SheetsIntegration
from app.workflow.integrations.ai_tools import AIToolsIntegration
from app.workflow.integrations.generic import GenericIntegration

# Register all integrations — add new ones here without touching core logic
IntegrationRegistry.register("gmail",   GmailIntegration())
IntegrationRegistry.register("slack",   SlackIntegration())
IntegrationRegistry.register("sheets",  SheetsIntegration())
IntegrationRegistry.register("ai",      AIToolsIntegration())
IntegrationRegistry.register("generic", GenericIntegration())

__all__ = ["IntegrationRegistry"]
