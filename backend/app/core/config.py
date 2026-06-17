# =============================================================================
# core/config.py — Centralized application settings via pydantic-settings
#
# All runtime configuration is declared here as a single Settings class.
# Values are loaded from the backend/.env file automatically. The class
# is wrapped in an lru_cache so Settings() is only constructed once per
# process — every caller gets the same singleton instance.
#
# Key setting groups:

#
# AI provider selection:
#   ai_provider = "openrouter" | "groq" | "anthropic"
#   Each provider has its own key/model/URL fields. The factory functions
#   in core/llm.py read ai_provider to decide which client to instantiate.
#
# LLM behaviour tuning (all have safe defaults):
#   llm_temperature      — 0.0 for deterministic workflow planning
#   max_execution_retries — rate-limit backoff attempts (not step retries)
#   max_fix_attempts     — max retry_action calls in the recovery agent
#   ai_tools_max_tokens  — cap for summarize/extract/transform outputs
#   text_input_max_chars — truncation limit before sending text to an LLM
#   planner_max_tokens   — cap for the workflow planning LLM call
#   max_agent_steps      — safety cutoff for the LangGraph ReAct agent loop
#
# Integration credentials (app-level, not user-level):
#   Google OAuth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET stay here.
#   User tokens (refresh_token etc.) go into the DB via credential_store.
#   Slack / Sheets env-var values are fallbacks when no DB credential exists.
#
# IMPORTANT: get_settings() uses lru_cache, so changes to .env require a
# server restart to take effect.
# =============================================================================
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    cors_origins: str = "http://localhost:3000"

    # AI provider: "openrouter" | "groq" | "anthropic"
    ai_provider: str = "openrouter"

    # OpenRouter (primary — OpenAI-compatible, routes to any model)
    openrouter_api_key: str = ""
    openrouter_model: str = "meta-llama/llama-3.3-70b-instruct"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    # Groq (legacy fallback)
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Anthropic (fallback)
    anthropic_api_key: str = ""
    ai_model: str = "claude-sonnet-4-6"

    # Memory
    memory_max_items: int = 100

    # Database
    database_url: str = "sqlite:///./workflow.db"

    # LLM / agent behaviour
    llm_temperature: float = 0.0
    max_execution_retries: int = 3   # backoff attempts for RATE_LIMIT errors in integrations
    max_fix_attempts: int = 2        # max retry_action calls inside the LangGraph recovery agent
    ai_tools_max_tokens: int = 1024  # max tokens for ai_tools summarize / extract / transform
    text_input_max_chars: int = 12000 # max chars of email body / text sent to an LLM prompt
    planner_max_tokens: int = 4096   # max tokens for the workflow planner LLM call
    max_agent_steps: int = 20        # max tool-call rounds in the agentic runner before stopping

    # Scheduler
    scheduler_timezone: str = "UTC"  # default timezone when workflow doesn't specify one

    # Google (Gmail + Sheets)
    # Option A — Service account (Google Workspace with domain-wide delegation)
    google_service_account_json: str = ""   # full JSON string of the service account key
    gmail_delegated_user: str = ""          # email to impersonate, e.g. you@yourdomain.com

    # Option B — OAuth2 refresh token (personal Gmail / standard account)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_refresh_token: str = ""

    # Slack
    slack_bot_token: str = ""               # xoxb-...
    slack_default_channel: str = "#general"

    # Google Sheets default spreadsheet
    sheets_spreadsheet_id: str = ""         # ID from the Sheets URL

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    model_config = {"env_file": ".env", "case_sensitive": False, "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
