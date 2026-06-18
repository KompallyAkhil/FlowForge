# =============================================================================
# workflow/integrations/slack.py — Slack integration adapter
#
# Connects to Slack using the Slack SDK WebClient with a bot token. The token
# is loaded fresh from the DB on every request via the `client` property
# (no caching) — this means connect/disconnect from the setup screen takes
# effect immediately without restarting the server. Falls back to the
# SLACK_BOT_TOKEN env var if no DB credential exists.
#
# Actions exposed to the workflow engine (_dispatch):
#   send_message(channel, text, blocks)
#     Posts a message to a Slack channel or user. `channel` accepts #channel-name
#     or a user ID. Returns {"sent": True, "channel": ..., "ts": ...}.
#
#   read_messages(channel, limit)
#     Reads the most recent N messages from a channel (default 10, max 100).
#     Returns {"messages": [{"text", "user", "ts", "type"}], "channel": ...}.
#     Returns {"messages": [], "total": 0} gracefully if channel is empty.
#
# Recovery:
#   _classify_error maps SlackApiError codes:
#     "channel_not_found", "invalid_channel" → FIXABLE
#     "ratelimited"                          → RATE_LIMIT
#     "not_authed", "invalid_auth"           → AUTH
#     "msg_too_long", "no_text"              → FATAL
#
#   _recover_fixable: on FIXABLE, lists all public channels to find a name
#     match and retries with the correct channel ID.
#   _get_recovery_tools: exposes list_slack_channels for the inline recovery
#     agent to discover the right channel name and retry.
#
# Agent tools (get_agent_tools):
#   slack_send_message, slack_read_messages — LangChain @tool functions
#   available to the main ReAct agent.
# =============================================================================
import json
import logging
from typing import Any

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from app.workflow.integrations.base import BaseIntegration, ErrorCategory, HumanInputRequired

logger = logging.getLogger(__name__)


def _rows_to_text(rows: list) -> str:
    """Convert a list or list-of-lists (e.g. Sheets rows) to a readable plain-text string."""
    if not rows:
        return ""
    if isinstance(rows[0], list):
        return "\n".join("\t".join(str(c) for c in row) for row in rows)
    return "\n".join(str(item) for item in rows)


class SlackIntegration(BaseIntegration):

    def __init__(self) -> None:
        pass  # client is built fresh on each access; no caching needed

    # ── Auth ──────────────────────────────────────────────────────────────────

    @property
    def client(self) -> WebClient:
        # Always look up fresh so newly-connected tokens are picked up without restart
        token: str | None = None

        # 1. DB credential saved via the setup screen
        try:
            from app.workflow.integrations.credential_store import get_integration_credentials
            data = get_integration_credentials("slack")
            if data:
                token = data.get("bot_token")
        except Exception as e:
            logger.warning("Failed to load Slack credentials from DB, falling back to .env: %s", e)

        # 2. Fall back to env var
        if not token:
            from app.core.config import get_settings
            token = get_settings().slack_bot_token

        if not token:
            raise RuntimeError(
                "Slack is not connected. Go to the setup screen to save a bot token, "
                "or set SLACK_BOT_TOKEN in backend/.env"
            )

        return WebClient(token=token, timeout=30)

    # ── Dispatch (required by BaseIntegration) ────────────────────────────────

    def _dispatch(self, action: str, params: dict[str, Any]) -> dict[str, Any]:
        handlers = {
            "send_message":      self._send_message,
            "get_messages":      self._get_messages,
            "create_channel":    self._create_channel,
            "post_notification": self._post_notification,
            "list_channels":     self._list_channels,
        }
        if action not in handlers:
            raise ValueError(
                f"Slack does not support action '{action}'. Available: {list(handlers)}"
            )
        return handlers[action](params)

    # ── Error classification ──────────────────────────────────────────────────

    def _classify_error(self, exc: Exception) -> ErrorCategory:
        if not isinstance(exc, SlackApiError):
            return ErrorCategory.UNKNOWN

        error = exc.response.get("error", "")

        if error in ("invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"):
            return ErrorCategory.AUTH

        if error in ("team_access_not_granted", "missing_scope", "org_login_required"):
            return ErrorCategory.FATAL

        if error == "ratelimited":
            return ErrorCategory.RATE_LIMIT

        if error in ("channel_not_found", "no_channel", "is_archived"):
            return ErrorCategory.FIXABLE

        if error == "not_in_channel":
            return ErrorCategory.FIXABLE   # recovery will raise a clear message

        return ErrorCategory.UNKNOWN

    # ── Pure-Python fixable recovery ──────────────────────────────────────────

    def _recover_fixable(self, action: str, params: dict, exc: Exception) -> dict:
        if not isinstance(exc, SlackApiError):
            raise exc

        error = exc.response.get("error", "")

        # channel_not_found / no_channel → resolve name to ID and retry
        if error in ("channel_not_found", "no_channel") and "channel" in params:
            try:
                channel_id = self._resolve_channel_id(params["channel"])
                return self._dispatch(action, {**params, "channel": channel_id})
            except RuntimeError as inner:
                # _resolve_channel_id raises RuntimeError when the channel truly doesn't exist
                msg = str(inner).lower()
                if "not found" in msg or "could not look up" in msg:
                    channel_name = params["channel"].lstrip("#")
                    raise HumanInputRequired(
                        question=f"Slack channel '#{channel_name}' does not exist. Create it?",
                        integration_name="slack",
                        resource_type="channel",
                        resource_name=channel_name,
                    )
                raise inner
            except Exception as inner:
                raise inner

        # not_in_channel — invite the bot first; we cannot fix this programmatically
        if error == "not_in_channel":
            raise RuntimeError(
                f"Bot is not a member of '{params.get('channel', '?')}'. "
                "Run /invite @YourBotName in that Slack channel first."
            ) from exc

        raise exc

    # ── HITL resource creation ────────────────────────────────────────────────

    def create_resource(self, resource_type: str, resource_name: str, _extra: dict) -> None:
        if resource_type == "channel":
            self.execute("create_channel", {"name": resource_name.lstrip("#")})

    # ── Agent tools (exposed to the LangGraph agent) ─────────────────────────

    def get_agent_tools(self) -> list:
        from langchain_core.tools import tool
        from typing import Annotated as Ann
        _self = self

        @tool
        def slack_send_message(
            channel: Ann[str, "Slack channel name including #, e.g. '#general'"],
            text: Ann[str, "Message text to post"],
        ) -> dict:
            """Send a message to a Slack channel. Only call if the user explicitly asked to post to Slack."""
            return _self.execute("send_message", {"channel": channel, "text": text})

        @tool
        def slack_get_messages(
            channel: Ann[str, "Slack channel name including #, e.g. '#general'"],
            limit: Ann[int, "Number of recent messages to fetch (default 10)"] = 10,
        ) -> dict:
            """Fetch recent messages from a Slack channel."""
            return _self.execute("get_messages", {"channel": channel, "limit": limit})

        @tool
        def slack_create_channel(
            name: Ann[str, "Channel name (lowercase, no spaces)"],
        ) -> dict:
            """Create a new Slack channel."""
            return _self.execute("create_channel", {"name": name})

        @tool
        def slack_list_channels() -> dict:
            """List all Slack channels visible to the bot."""
            return _self.execute("list_channels", {})

        return [slack_send_message, slack_get_messages, slack_create_channel, slack_list_channels]

    def get_planner_spec(self) -> dict:
        from app.core.config import get_settings
        default_ch = get_settings().slack_default_channel or "#general"
        return {
            "name": "slack",
            "use_case": "messaging, channels, notifications",
            "output_keywords": ['"send to Slack"', '"post to Slack"', '"notify on Slack"'],
            "agent_strategy": "- Slack output: slack_send_message — only when explicitly requested",
            "planner_notes": (
                f"Only add a slack.send_message step when the user explicitly says \"send to Slack\", "
                f"\"post to Slack\", or \"notify on Slack\". Never add it for read/fetch/summarize requests.\n"
                f"Default channel is \"{default_ch}\" — use it whenever the user does not name a channel.\n"
                f"Never invent a channel name; if a channel is required but not configured, use \"{default_ch}\".\n"
                f"The \"text\" param accepts any upstream step output: summary (\"${{step_N.summary}}\"), "
                f"extracted fields, or raw Sheets rows — all are accepted and formatted automatically.\n"
                f"Do not add slack.send_message AND gmail.send_email for the same output unless the user asks for both."
            ),
            "chaining_examples": [
                {
                    "description": "Post a summary of recent channel messages back to Slack",
                    "steps": [
                        {"integration": "slack", "action": "get_messages",  "params": {"channel": default_ch, "limit": 10}},
                        {"integration": "ai",    "action": "summarize",     "params": {"text": "${step_1.messages}"}},
                        {"integration": "slack", "action": "send_message",  "params": {"channel": default_ch, "text": "${step_2.summary}"}},
                    ],
                    "note": "step_1 fetches, step_2 summarizes, step_3 posts — never self-reference",
                },
                {
                    "description": "Read a Sheets table and post it to Slack",
                    "steps": [
                        {"integration": "sheets", "action": "read_rows",    "params": {"sheet": "Sheet1"}},
                        {"integration": "slack",  "action": "send_message", "params": {"channel": default_ch, "text": "${step_1.rows}"}},
                    ],
                    "note": "raw rows are formatted automatically — no ai.summarize needed unless user asked for a summary",
                },
            ],
            "actions": [
                {"name": "send_message",      "params": {"channel": default_ch, "text": "message text here"}, "output": None},
                {"name": "post_notification", "params": {"channel": default_ch, "text": "..."},               "output": None},
                {"name": "get_messages",      "params": {"channel": default_ch, "limit": 10},                 "output": None},
                {"name": "create_channel",    "params": {"name": "channel-name"},                             "output": None},
                {"name": "list_channels",     "params": {},                                                    "output": None},
            ],
        }

    def get_configured_resources(self) -> list[tuple[str, str]]:
        from app.core.config import get_settings
        s = get_settings()
        if s.slack_default_channel:
            return [("Slack default channel", s.slack_default_channel)]
        return []

    # ── Discovery tools for LangGraph recovery agent ──────────────────────────

    def _get_recovery_tools(self) -> list:
        from langchain_core.tools import tool

        get_client = lambda: self.client  # always fetch a fresh client at call time

        @tool
        def list_slack_channels() -> str:
            """
            List all Slack channels the bot can see (public + private).
            Returns a JSON array of {id, name, is_private} objects.
            Use this to find the correct channel ID when a channel name is wrong or not found.
            """
            try:
                channels: list[dict] = []
                cursor = None
                client_ref = get_client()
                while True:
                    kwargs: dict = {"limit": 200, "types": "public_channel,private_channel"}
                    if cursor:
                        kwargs["cursor"] = cursor
                    resp = client_ref.conversations_list(**kwargs)
                    for ch in resp.get("channels", []):
                        channels.append({
                            "id":         ch["id"],
                            "name":       ch["name"],
                            "is_private": ch.get("is_private", False),
                        })
                    meta = resp.get("response_metadata", {})
                    cursor = meta.get("next_cursor")
                    if not cursor:
                        break
                return json.dumps(channels[:60])   # cap at 60 to stay within context window
            except Exception as e:
                return json.dumps({"error": str(e)})

        return [list_slack_channels]

    # ── Actions ───────────────────────────────────────────────────────────────

    def _list_channels(self, params: dict) -> dict:
        channels: list[dict] = []
        cursor = None
        while True:
            kwargs: dict = {"limit": 200, "types": "public_channel,private_channel"}
            if cursor:
                kwargs["cursor"] = cursor
            try:
                resp = self.client.conversations_list(**kwargs)
            except SlackApiError as e:
                raise RuntimeError(f"Slack list_channels failed: {e.response['error']}") from e
            for ch in resp.get("channels", []):
                channels.append({
                    "id":         ch["id"],
                    "name":       f"#{ch['name']}",
                    "is_private": ch.get("is_private", False),
                    "is_member":  ch.get("is_member", False),
                })
            meta = resp.get("response_metadata", {})
            cursor = meta.get("next_cursor")
            if not cursor:
                break
        return {"channels": channels, "total": len(channels)}

    def _send_message(self, params: dict) -> dict:
        from app.core.config import get_settings
        channel = (params.get("channel") or get_settings().slack_default_channel or "").lstrip("#")
        text = params.get("text") or params.get("message", "")
        # ${step_N.rows} resolves to a list-of-lists; convert to readable text
        if isinstance(text, list):
            text = _rows_to_text(text)
        elif isinstance(text, dict):
            text = json.dumps(text, indent=2)
        if not text:
            raise ValueError("'text' is required for send_message")

        response = self.client.chat_postMessage(channel=channel, text=text)
        return {
            "status":  "delivered",
            "channel": response["channel"],
            "ts":      response["ts"],
            "message": text,
        }

    def _resolve_channel_id(self, channel: str) -> str:
        """
        conversations_history requires a channel ID (C…), not a name.
        Resolve channel name → ID by paginating conversations_list.
        """
        name = channel.lstrip("#").lower()

        # Already looks like a Slack ID (C…, G…, D…)
        if len(name) > 6 and name[0].upper() in ("C", "G", "D") and name[1:].isalnum():
            return channel

        try:
            cursor = None
            while True:
                kwargs: dict = {"limit": 200, "types": "public_channel,private_channel"}
                if cursor:
                    kwargs["cursor"] = cursor
                resp = self.client.conversations_list(**kwargs)
                for ch in resp.get("channels", []):
                    if ch["name"].lower() == name:
                        return ch["id"]
                meta = resp.get("response_metadata", {})
                cursor = meta.get("next_cursor")
                if not cursor:
                    break
        except SlackApiError as e:
            raise RuntimeError(
                f"Could not look up channel '{channel}': {e.response['error']}"
            ) from e

        raise RuntimeError(
            f"Channel '{channel}' not found. "
            "Make sure the bot is invited to it: /invite @YourBotName in the channel."
        )

    def _get_messages(self, params: dict) -> dict:
        from app.core.config import get_settings
        channel = params.get("channel") or get_settings().slack_default_channel
        limit   = int(params.get("limit", 20))

        channel_id = self._resolve_channel_id(channel)

        try:
            response = self.client.conversations_history(channel=channel_id, limit=limit)
        except SlackApiError as e:
            error = e.response["error"]
            if error == "not_in_channel":
                raise RuntimeError(
                    f"Bot is not a member of '{channel}'. "
                    "Run /invite @YourBotName in that Slack channel first."
                ) from e
            raise RuntimeError(f"Slack get_messages failed: {error}") from e

        messages = [
            {
                "user": m.get("user", ""),
                "text": m.get("text", ""),
                "ts":   m.get("ts", ""),
                "type": m.get("type", "message"),
            }
            for m in response.get("messages", [])
            if m.get("type") == "message" and not m.get("subtype")
        ]

        return {
            "channel":    channel,
            "channel_id": channel_id,
            "messages":   messages,
            "total":      len(messages),
        }

    def _create_channel(self, params: dict) -> dict:
        name = params.get("name")
        if not name:
            raise ValueError("'name' is required for create_channel")
        name = name.lower().replace(" ", "-")

        try:
            response = self.client.conversations_create(
                name=name, is_private=params.get("is_private", False)
            )
        except SlackApiError as e:
            error = e.response["error"]
            if error == "name_taken":
                return {"status": "already_exists", "name": name}
            raise RuntimeError(f"Slack create_channel failed: {error}") from e

        channel = response["channel"]
        return {
            "status":     "created",
            "channel_id": channel["id"],
            "name":       channel["name"],
            "is_private": channel.get("is_private", False),
        }

    def _post_notification(self, params: dict) -> dict:
        from app.core.config import get_settings
        channel = params.get("channel") or get_settings().slack_default_channel
        title   = params.get("title", "Notification")
        text    = params.get("text") or params.get("message", "")
        if isinstance(text, list):
            text = _rows_to_text(text)
        elif isinstance(text, dict):
            text = json.dumps(text, indent=2)
        color   = {
            "info":    "#36a64f",
            "warning": "#ffae00",
            "error":   "#e01e5a",
        }.get(params.get("type", "info"), "#36a64f")

        blocks      = [{"type": "section", "text": {"type": "mrkdwn", "text": f"*{title}*\n{text}"}}]
        attachments = [{"color": color, "blocks": blocks}]

        response = self.client.chat_postMessage(
            channel=channel, text=title, attachments=attachments
        )
        return {
            "status":  "posted",
            "channel": response["channel"],
            "ts":      response["ts"],
            "title":   title,
        }
