# =============================================================================
# workflow/integrations/generic.py — Catch-all integration for any step
#
# Handles any workflow step whose integration field is "generic" — used when
# the LLM planner needs to describe a business action that doesn't map to
# gmail, slack, sheets, or ai (e.g. "create CRM record", "trigger webhook",
# "update database", "assign onboarding sequence").
#
# _dispatch(action, params) routes based on what's in params:
#
#   With "webhook_url" or "url" in params → _call_webhook()
#     POSTs the remaining params as JSON to the URL using httpx.
#     Returns {"status": "webhook_called", "http_status": N, "response": {...}}.
#     Raises RuntimeError on HTTP 4xx/5xx or connection errors.
#     httpx is imported lazily so it doesn't break installs that skip it.
#
#   Without a URL → _manual_step()
#     Records the step as a human-required action. Does not make any API call.
#     Returns {"status": "manual_required", "action": "...", "description": "..."}.
#     The "description" comes from params["description"] (set by the planner)
#     and is shown in the execution UI as a task the user needs to complete.
#
# get_planner_spec() returns None — the generic integration is described in
# prompts.py (PLANNER_GENERIC_INTEGRATION) rather than via the registry spec
# system, because its behavior is too open-ended to enumerate as actions.
#
# The generic integration intentionally does NOT expose get_agent_tools() —
# the LangGraph agent should never call generic steps autonomously.
# =============================================================================
import json
import logging
from typing import Any

from app.workflow.integrations.base import BaseIntegration, ErrorCategory

logger = logging.getLogger(__name__)


class GenericIntegration(BaseIntegration):

    def _dispatch(self, action: str, params: dict[str, Any]) -> dict[str, Any]:
        webhook_url = params.get("webhook_url") or params.get("url")
        if webhook_url:
            return self._call_webhook(action, params, webhook_url)
        return self._manual_step(action, params)

    def _classify_error(self, exc: Exception) -> ErrorCategory:
        msg = str(exc).lower()
        if "401" in msg or "403" in msg or "unauthorized" in msg or "forbidden" in msg:
            return ErrorCategory.AUTH
        if "429" in msg or "rate" in msg:
            return ErrorCategory.RATE_LIMIT
        if "404" in msg or "not found" in msg:
            return ErrorCategory.FIXABLE
        if "timeout" in msg or "connection" in msg:
            return ErrorCategory.UNKNOWN
        return ErrorCategory.UNKNOWN

    def _call_webhook(self, action: str, params: dict, webhook_url: str) -> dict:
        try:
            import httpx
        except ImportError:
            raise RuntimeError(
                "httpx is required for webhook steps. Run: pip install httpx"
            )

        payload = {k: v for k, v in params.items() if k not in ("webhook_url", "url")}
        payload["action"] = action

        logger.info("Generic step '%s' calling webhook: %s", action, webhook_url)
        try:
            response = httpx.post(
                webhook_url,
                json=payload,
                timeout=30,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(
                f"Webhook call failed (HTTP {e.response.status_code}): {e.response.text[:200]}"
            ) from e
        except httpx.RequestError as e:
            raise RuntimeError(f"Webhook request error: {e}") from e

        try:
            body = response.json()
        except Exception:
            body = {"raw": response.text}

        return {
            "status":      "webhook_called",
            "action":      action,
            "webhook_url": webhook_url,
            "http_status": response.status_code,
            "response":    body,
        }

    def _manual_step(self, action: str, params: dict) -> dict:
        description = (
            params.get("description")
            or params.get("summary")
            or f"Manual action: {action.replace('_', ' ').title()}"
        )
        logger.info("Generic step '%s' recorded as manual action", action)
        return {
            "status":      "manual_required",
            "action":      action,
            "description": description,
            "params":      {k: v for k, v in params.items() if k != "description"},
        }
