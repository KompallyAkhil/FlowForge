import json
import re
import time
from typing import Any

from app.prompts import (
    SUMMARIZE_SYSTEM, SUMMARIZE_USER, SUMMARIZE_STYLE_INSTRUCTIONS, SUMMARIZE_STYLE_DEFAULT,
    EXTRACT_SYSTEM, EXTRACT_USER,
    TRANSFORM_SYSTEM, TRANSFORM_USER,
)
from app.workflow.integrations.base import BaseIntegration, ErrorCategory


def _to_text(value: Any, max_chars: int = 0) -> str:
    """Convert any resolved step output to a readable string for LLM input.

    Handles the common case where ${step_N.rows} resolves to a list-of-lists
    (Google Sheets rows), ${step_N.emails} to a list of dicts, or any scalar.

    When max_chars > 0 and value is a list, rows are sampled intelligently:
    the header row is always kept, then data rows are added until the budget is
    reached, with a trailing count of omitted rows so the LLM knows the scope.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        if not value:
            return ""
        # List of lists → Sheets-style rows, render as lines of comma-separated values
        if isinstance(value[0], list):
            total = len(value)
            lines: list[str] = []
            chars = 0
            for i, row in enumerate(value):
                line = ", ".join(str(cell) for cell in row)
                if max_chars and chars + len(line) + 1 > max_chars and i > 0:
                    omitted = total - i
                    lines.append(f"... ({omitted} of {total} rows omitted — summary covers first {i} rows)")
                    break
                lines.append(line)
                chars += len(line) + 1
            return "\n".join(lines)
        # List of dicts → key: value blocks separated by blank lines
        if isinstance(value[0], dict):
            blocks = []
            for item in value:
                blocks.append("\n".join(f"{k}: {v}" for k, v in item.items() if v not in (None, "")))
            return "\n\n".join(blocks)
        # List of scalars
        return "\n".join(str(item) for item in value)
    if isinstance(value, dict):
        return "\n".join(f"{k}: {v}" for k, v in value.items() if v not in (None, ""))
    return str(value)


class AIToolsIntegration(BaseIntegration):
    """AI processing steps: summarize, extract, transform text using the configured LLM provider."""

    # If the provider says the wait is longer than this, fail immediately rather than blocking.
    _MAX_INLINE_WAIT = 120.0  # seconds

    # ── Error classification ──────────────────────────────────────────────────

    def _classify_error(self, exc: Exception) -> ErrorCategory:
        err = str(exc).lower()
        if "429" in err or "rate_limit" in err or "rate limit" in err or "token quota" in err:
            return ErrorCategory.RATE_LIMIT
        if "401" in err or "403" in err or "invalid_api_key" in err or "authentication" in err:
            return ErrorCategory.AUTH
        return ErrorCategory.UNKNOWN

    @staticmethod
    def _parse_retry_after(exc: Exception) -> float | None:
        """Extract the retry-after duration in seconds from a provider error message."""
        m = re.search(r'try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s', str(exc), re.IGNORECASE)
        if m:
            return int(m.group(1) or 0) * 60 + float(m.group(2) or 0)
        m = re.search(r'retry[_\-]?after[:\s]+(\d+)', str(exc), re.IGNORECASE)
        if m:
            return float(m.group(1))
        return None

    def _handle_rate_limit(self, action: str, params: dict, exc: Exception) -> dict:
        wait = self._parse_retry_after(exc)
        if wait and wait > self._MAX_INLINE_WAIT:
            m, s = divmod(int(wait), 60)
            time_str = f"{m}m {s}s" if m else f"{s}s"
            raise RuntimeError(
                f"AI rate limit exceeded — provider asks to retry after {time_str}. "
                "To continue immediately, set AI_PROVIDER=anthropic with a valid ANTHROPIC_API_KEY "
                "in backend/.env, or wait until the quota resets."
            )
        # Short wait — use standard exponential backoff
        return super()._handle_rate_limit(action, params, exc)

    # ── Agent tools (exposed to the LangGraph agent) ─────────────────────────

    def get_agent_tools(self) -> list:
        from langchain_core.tools import tool
        from typing import Annotated as Ann
        _self = self

        @tool
        def ai_summarize(
            text: Ann[str, "Text content to summarize (email body, document, etc.)"],
            subject: Ann[str, "Subject or title (optional, helps quality)"] = "",
            sender: Ann[str, "Who sent it (optional, helps context)"] = "",
            style: Ann[str, "Output style: 'bullet_points', 'paragraph', or 'brief'"] = "bullet_points",
        ) -> dict:
            """Summarize text/email content using AI. Returns a 'summary' field with the result."""
            return _self.execute("summarize", {"text": text, "subject": subject, "from": sender, "style": style})

        @tool
        def ai_extract(
            text: Ann[str, "Text to extract structured data from"],
            fields: Ann[list[str], "Fields to extract, e.g. ['invoice_number', 'amount', 'due_date']"],
        ) -> dict:
            """Extract specific fields from text using AI. Returns an 'extracted' dict with the requested fields."""
            return _self.execute("extract", {"text": text, "fields": fields})

        @tool
        def ai_transform(
            text: Ann[str, "Text to rewrite or transform"],
            instruction: Ann[str, "Transformation instruction, e.g. 'Make this formal' or 'Translate to Spanish'"],
        ) -> dict:
            """Rewrite or transform text according to an instruction. Returns a 'result' field."""
            return _self.execute("transform", {"text": text, "instruction": instruction})

        return [ai_summarize, ai_extract, ai_transform]

    def get_planner_spec(self) -> dict:
        return {
            "name": "ai",
            "use_case": "summarize, extract, transform any text",
            "output_keywords": [],
            "agent_strategy": "- Summarising: ai_summarize(text=<body>, subject=<subject>, sender=<from>)",
            "actions": [
                {
                    "name": "summarize",
                    "params": {"text": "${step_N.body}", "style": "bullet_points"},
                    "output": {"summary": "...", "subject": "...", "sender": "..."},
                    "output_note": (
                        "→ 'text' accepts ANY value — string, list, or array of rows — all converted automatically.\n"
                        "  • For Sheets rows:  text: \"${step_N.rows}\"  where N = the sheets.read_rows step number\n"
                        "  • For email body:   text: \"${step_N.body}\"  where N = the read_email step number\n"
                        "  • For batch emails: text: \"${step_N.combined_text}\"  where N = the read_emails_batch step number\n"
                        "  N is NEVER the current summarize step — always the step BEFORE it that produced the data.\n"
                        "  Downstream steps use ${step_M.summary} where M is THIS summarize step's number."
                    ),
                },
                {
                    "name": "extract",
                    "params": {"text": "${step_N.body}", "fields": ["field_a", "field_b"]},
                    "output": {"extracted": {"field_a": "value"}, "fields": ["..."]},
                },
                {
                    "name": "transform",
                    "params": {"text": "${step_N.body}", "instruction": "Rewrite as a formal notification"},
                    "output": None,
                },
            ],
        }

    def _dispatch(self, action: str, params: dict[str, Any]) -> dict[str, Any]:
        handlers = {
            "summarize": self._summarize,
            "extract":   self._extract,
            "transform": self._transform,
        }
        if action not in handlers:
            raise ValueError(f"AI does not support action '{action}'. Available: {list(handlers)}")
        return handlers[action](params)

    def _summarize(self, params: dict) -> dict:
        from app.core.llm import chat_complete
        from app.core.config import get_settings

        raw = (
            params.get("text") or params.get("body")
            or params.get("content") or params.get("snippet") or ""
        )
        s       = get_settings()
        # Pass max_chars so list-of-lists (sheet rows) are sampled row-by-row
        # rather than truncated mid-row by a character slice.
        text = _to_text(raw, max_chars=s.text_input_max_chars).strip()
        if not text:
            return {
                "summary": "No content found to summarize — the upstream step returned no data.",
                "subject": "",
                "sender": "",
                "original_length": 0,
            }

        subject = params.get("subject", "")
        sender  = params.get("from", params.get("sender", ""))
        style   = params.get("style", "bullet_points")

        context = ""
        if subject:
            context += f"Subject: {subject}\n"
        if sender:
            context += f"From: {sender}\n"

        style_instruction = SUMMARIZE_STYLE_INSTRUCTIONS.get(style, SUMMARIZE_STYLE_DEFAULT)
        user_prompt = SUMMARIZE_USER.format(
            context=context,
            text=text[:s.text_input_max_chars],
            style_instruction=style_instruction,
        )

        summary = chat_complete(
            system=SUMMARIZE_SYSTEM,
            user=user_prompt,
            max_tokens=s.ai_tools_max_tokens,
        )
        return {
            "summary":         summary,
            "subject":         subject,
            "sender":          sender,
            "original_length": len(text),
        }

    def _extract(self, params: dict) -> dict:
        from app.core.llm import chat_complete
        from app.core.config import get_settings

        raw = (
            params.get("text") or params.get("body")
            or params.get("content") or params.get("snippet") or ""
        )
        text = _to_text(raw).strip()
        if not text:
            raise ValueError("'text' is required for ai.extract")

        s      = get_settings()
        fields = params.get("fields", ["key_points", "action_items", "dates"])

        user_prompt = EXTRACT_USER.format(
            fields=", ".join(fields) if isinstance(fields, list) else fields,
            text=text[:s.text_input_max_chars],
        )

        raw = chat_complete(
            system=EXTRACT_SYSTEM,
            user=user_prompt,
            max_tokens=s.ai_tools_max_tokens,
        )
        raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
        raw = re.sub(r"\n?```\s*$", "", raw)
        try:
            extracted = json.loads(raw)
        except Exception:
            extracted = {"raw": raw}

        return {"extracted": extracted, "fields": fields}

    def _transform(self, params: dict) -> dict:
        from app.core.llm import chat_complete
        from app.core.config import get_settings

        raw = (
            params.get("text") or params.get("content")
            or params.get("body") or params.get("snippet") or ""
        )
        text = _to_text(raw).strip()
        if not text:
            raise ValueError("'text' is required for ai.transform")

        s           = get_settings()
        instruction = params.get("instruction", "Rewrite this text clearly.")

        user_prompt = TRANSFORM_USER.format(
            instruction=instruction,
            text=text[:s.text_input_max_chars],
        )
        result = chat_complete(
            system=TRANSFORM_SYSTEM,
            user=user_prompt,
            max_tokens=s.ai_tools_max_tokens,
        )
        return {"result": result, "instruction": instruction}
