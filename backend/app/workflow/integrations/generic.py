"""
Generic integration — catch-all for any workflow step that doesn't map to a known integration.

Execution strategy (in order):
  1. If params contain 'webhook_url' or 'url' → POST to that endpoint.
  2. Otherwise → record the step as a manual action and return structured metadata.

This lets the planner describe business steps (create_crm_record, notify_sales, etc.)
in a way that is inspectable, modifiable, and optionally executable via webhook.
"""
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
