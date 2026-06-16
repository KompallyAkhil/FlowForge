import base64
import json
import logging
import re
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.prompts import INVOICE_EXTRACTION_USER
from app.workflow.integrations.base import BaseIntegration, ErrorCategory

logger = logging.getLogger(__name__)

GMAIL_SCOPES = ["https://mail.google.com/"]


def _rows_to_text(rows: list) -> str:
    """Convert a list or list-of-lists (e.g. Sheets rows) to a readable plain-text string."""
    if not rows:
        return ""
    if isinstance(rows[0], list):
        return "\n".join("\t".join(str(c) for c in row) for row in rows)
    return "\n".join(str(item) for item in rows)


class GmailIntegration(BaseIntegration):

    def __init__(self) -> None:
        self._service = None

    # ── Auth ──────────────────────────────────────────────────────────────────

    @property
    def service(self):
        if self._service is None:
            self._service = build("gmail", "v1", credentials=self._credentials())
        return self._service

    def _credentials(self):
        # 1. DB credentials saved via the setup screen take priority
        try:
            from app.workflow.integrations.credential_store import get_integration_credentials
            data = get_integration_credentials("gmail")
            if data and data.get("refresh_token"):
                from google.oauth2.credentials import Credentials
                return Credentials(
                    token=None,
                    refresh_token=data["refresh_token"],
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=data["client_id"],
                    client_secret=data["client_secret"],
                    scopes=GMAIL_SCOPES,
                )
        except Exception as e:
            logger.warning("Failed to load Gmail credentials from DB, falling back to .env: %s", e)

        # 2. Fall back to env-var credentials
        from app.core.config import get_settings
        s = get_settings()

        if s.google_service_account_json:
            from google.oauth2 import service_account
            info = json.loads(s.google_service_account_json)
            creds = service_account.Credentials.from_service_account_info(
                info, scopes=GMAIL_SCOPES
            )
            if s.gmail_delegated_user:
                creds = creds.with_subject(s.gmail_delegated_user)
            return creds

        if s.google_refresh_token:
            from google.oauth2.credentials import Credentials
            return Credentials(
                token=None,
                refresh_token=s.google_refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=s.google_client_id,
                client_secret=s.google_client_secret,
                scopes=GMAIL_SCOPES,
            )

        raise RuntimeError(
            "Gmail is not connected. Go to the setup screen to sign in with Google, "
            "or set GOOGLE_REFRESH_TOKEN in backend/.env"
        )

    # ── Dispatch (required by BaseIntegration) ────────────────────────────────

    def _dispatch(self, action: str, params: dict[str, Any]) -> dict[str, Any]:
        handlers = {
            "send_email":        self._send_email,
            "read_email":        self._read_email,
            "read_emails_batch": self._read_emails_batch,
            "extract_invoice":   self._extract_invoice,
            "search_emails":     self._search_emails,
            "get_attachments":   self._get_attachments,
        }
        if action not in handlers:
            raise ValueError(
                f"Gmail does not support action '{action}'. Available: {list(handlers)}"
            )
        return handlers[action](params)

    # ── Error classification ──────────────────────────────────────────────────

    def _classify_error(self, exc: Exception) -> ErrorCategory:
        # Action methods wrap HttpError in RuntimeError — unwrap __cause__ to get the status code
        http_err = exc if isinstance(exc, HttpError) else getattr(exc, "__cause__", None)
        if isinstance(http_err, HttpError):
            status = http_err.resp.status
            if status in (401, 403):
                return ErrorCategory.AUTH
            if status == 429:
                return ErrorCategory.RATE_LIMIT
            if status in (404, 400):
                return ErrorCategory.FIXABLE
            if status in (500, 503):
                return ErrorCategory.UNKNOWN
        return ErrorCategory.UNKNOWN

    # ── Pure-Python fixable recovery ──────────────────────────────────────────

    def _recover_fixable(self, action: str, params: dict, exc: Exception) -> dict:
        """
        When a specific message ID is invalid (404 / 400), re-search the inbox
        and retry with the first real message ID that comes back.
        """
        http_err = exc if isinstance(exc, HttpError) else getattr(exc, "__cause__", None)
        if not isinstance(http_err, HttpError):
            raise exc
        if action not in ("read_email", "get_attachments", "extract_invoice"):
            raise exc

        # Derive a search query from whatever context we have in params
        subject_hint = params.get("subject", "")
        sender_hint  = params.get("from", "")
        query_parts  = ["in:inbox"]
        if subject_hint:
            query_parts.append(f"subject:{subject_hint}")
        if sender_hint:
            query_parts.append(f"from:{sender_hint}")
        query = " ".join(query_parts)

        try:
            search_result = self._search_emails({"query": query, "max_results": 1})
            emails = search_result.get("emails", [])
            if not emails:
                raise exc
            corrected_params = {**params, "message_id": emails[0]["id"]}
            return self._dispatch(action, corrected_params)
        except Exception as inner:
            # If the re-search itself fails, surface the original error
            if inner is exc:
                raise
            raise exc from inner

    # ── Agent tools (exposed to the LangGraph agent) ─────────────────────────

    def get_agent_tools(self) -> list:
        from langchain_core.tools import tool
        from typing import Annotated as Ann
        _self = self

        @tool
        def gmail_search_emails(
            query: Ann[str, "Gmail search query, e.g. 'in:inbox' or 'from:boss@company.com'"],
            max_results: Ann[int, "Maximum emails to return (default 5)"] = 5,
        ) -> dict:
            """Search Gmail for emails matching the query. Returns a list of email summaries with IDs."""
            return _self.execute("search_emails", {"query": query, "max_results": max_results})

        @tool
        def gmail_read_email(
            message_id: Ann[str, "The Gmail message ID (from gmail_search_emails result)"],
        ) -> dict:
            """Read the full content of a single email: subject, from, body, snippet."""
            return _self.execute("read_email", {"message_id": message_id})

        @tool
        def gmail_read_emails_batch(
            emails: Ann[list, "List of email objects from gmail_search_emails (each has an 'id' field)"],
        ) -> dict:
            """Read the full body of every email returned by a search. Returns combined_text with all bodies joined."""
            return _self.execute("read_emails_batch", {"emails": emails})

        @tool
        def gmail_send_email(
            to: Ann[str, "Recipient email address"],
            subject: Ann[str, "Email subject line"],
            body: Ann[str, "Email body text"],
        ) -> dict:
            """Send an email via Gmail. Only call when user explicitly asks to send an email."""
            return _self.execute("send_email", {"to": to, "subject": subject, "body": body})

        @tool
        def gmail_get_attachments(
            message_id: Ann[str, "The Gmail message ID to list attachments for"],
        ) -> dict:
            """List all attachments for a Gmail message."""
            return _self.execute("get_attachments", {"message_id": message_id})

        @tool
        def gmail_extract_invoice(
            message_id: Ann[str, "The Gmail message ID (from gmail_search_emails result)"],
        ) -> dict:
            """Read an email and extract structured invoice fields: invoice_number, vendor, amount, currency, due_date, issue_date, line_items."""
            return _self.execute("extract_invoice", {"message_id": message_id})

        return [gmail_search_emails, gmail_read_email, gmail_read_emails_batch, gmail_extract_invoice, gmail_send_email, gmail_get_attachments]

    def get_planner_spec(self) -> dict:
        return {
            "name": "gmail",
            "use_case": "sending/reading/searching emails",
            "output_keywords": ['"email me"', '"send an email"'],
            "agent_strategy": (
                "- Emails: call gmail_search_emails first, then choose the right follow-up:\n"
                "  • invoice/billing email → gmail_extract_invoice (returns structured fields)\n"
                "  • multiple emails to summarize → gmail_read_emails_batch\n"
                "  • single email to read → gmail_read_email"
            ),
            "actions": [
                {
                    "name": "search_emails",
                    "params": {"query": "subject:invoice", "max_results": 5},
                    "output": {"emails": [{"id": "abc123", "subject": "...", "from": "...", "date": "...", "snippet": "..."}], "total": 1},
                    "output_note": (
                        "→ search_emails returns ONLY: emails[].id, emails[].subject, emails[].from, "
                        "emails[].date, emails[].snippet — NO body, NO combined_text.\n"
                        "  You MUST add a follow-up step to get full content:\n"
                        "  • summarise multiple emails → NEXT step: read_emails_batch {emails: \"${step_N.emails}\"}\n"
                        "    then ai.summarize {text: \"${step_M.combined_text}\"} where M = the read_emails_batch step number\n"
                        "  • invoice/billing email   → NEXT step: extract_invoice {message_id: \"${step_N.emails[0].id}\"}\n"
                        "  • single email to read    → NEXT step: read_email {message_id: \"${step_N.emails[0].id}\"}\n"
                        "  NEVER reference ${step_N.combined_text} or ${step_N.body} from a search_emails step — "
                        "those fields do not exist on its output.\n"
                        "  N in all of the above = THIS search_emails step number."
                    ),
                },
                {
                    "name": "extract_invoice",
                    "params": {"message_id": "${step_N.emails[0].id}"},
                    "output": {
                        "invoice_number": "INV-001",
                        "vendor":         "Acme Corp",
                        "amount":         1500.00,
                        "currency":       "USD",
                        "due_date":       "2026-07-01",
                        "issue_date":     "2026-06-15",
                        "line_items":     [{"description": "...", "quantity": 1, "unit_price": 1500.00}],
                        "email_id":       "abc123",
                        "from_email":     "billing@vendor.com",
                    },
                    "output_note": (
                        "→ N = the search_emails step number. Use for invoice/billing emails.\n"
                        "  Returns structured fields you can chain directly (M = this extract_invoice step):\n"
                        "  ${step_M.vendor}, ${step_M.invoice_number}, ${step_M.amount}, ${step_M.currency},\n"
                        "  ${step_M.due_date}, ${step_M.issue_date}, ${step_M.from_email}"
                    ),
                },
                {
                    "name": "read_emails_batch",
                    "params": {"emails": "${step_N.emails}"},
                    "output": {
                        "emails": [{"id": "...", "from": "...", "subject": "...", "body": "..."}],
                        "combined_text": "Email 1 from ...\\n---\\nbody...\\n\\nEmail 2 from ...",
                        "total": 2,
                    },
                    "output_note": (
                        "→ N = the search_emails step number (e.g. if search_emails is step_1, use ${step_1.emails}).\n"
                        "  Use for 1 or more emails — handles both gracefully.\n"
                        "  combined_text joins all email bodies. Downstream steps use ${step_M.combined_text} "
                        "where M = this read_emails_batch step number."
                    ),
                },
                {
                    "name": "read_email",
                    "params": {"message_id": "${step_N.emails[0].id}"},
                    "output": {"message_id": "...", "subject": "...", "from": "...", "body": "...", "snippet": "..."},
                    "output_note": (
                        "→ N = the search_emails step number. Single email only. "
                        "For multiple emails use read_emails_batch."
                    ),
                },
                {
                    "name": "send_email",
                    "params": {"to": "user@example.com", "subject": "...", "body": "..."},
                    "output": None,
                },
                {
                    "name": "get_attachments",
                    "params": {"message_id": "..."},
                    "output": None,
                },
            ],
        }

    # ── Discovery tools for LangGraph recovery agent ──────────────────────────

    def _get_recovery_tools(self) -> list:
        from langchain_core.tools import tool

        search_ref = self._search_emails

        @tool
        def search_gmail_messages(query: str, max_results: int = 5) -> str:
            """
            Search Gmail for messages matching a query.
            Returns a JSON object with email IDs, subjects, senders, and dates.
            Use this to find the correct message_id when a read_email call fails.

            Args:
                query: Gmail search query (e.g. 'from:boss@company.com subject:invoice').
                max_results: Maximum number of results to return (default 5).
            """
            try:
                return json.dumps(search_ref({"query": query, "max_results": max_results}))
            except Exception as e:
                return json.dumps({"error": str(e)})

        return [search_gmail_messages]

    # ── Actions ───────────────────────────────────────────────────────────────

    def _send_email(self, params: dict) -> dict:
        to = params.get("to") or params.get("recipient")
        if not to:
            raise ValueError("'to' is required for send_email")

        subject = params.get("subject", "No Subject")
        body    = params.get("body", "")
        html    = params.get("html")

        # ${step_N.rows} resolves to a list-of-lists; convert to readable text
        if isinstance(body, list):
            body = _rows_to_text(body)
        elif isinstance(body, dict):
            body = json.dumps(body, indent=2)

        if html:
            msg = MIMEMultipart("alternative")
            msg["to"]      = to
            msg["subject"] = subject
            msg.attach(MIMEText(body, "plain"))
            msg.attach(MIMEText(html, "html"))
        else:
            msg = MIMEText(body)
            msg["to"]      = to
            msg["subject"] = subject

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        try:
            result = self.service.users().messages().send(
                userId="me", body={"raw": raw}
            ).execute()
        except HttpError as e:
            raise RuntimeError(f"Gmail send_email failed: {e}") from e

        return {"status": "sent", "message_id": result["id"], "to": to, "subject": subject}

    def _read_email(self, params: dict) -> dict:
        message_id = params.get("message_id")
        if not message_id:
            raise ValueError("'message_id' is required for read_email")

        try:
            msg = self.service.users().messages().get(
                userId="me", id=message_id, format="full"
            ).execute()
        except HttpError as e:
            raise RuntimeError(f"Gmail read_email failed: {e}") from e

        headers = {h.get("name", ""): h.get("value", "") for h in msg["payload"].get("headers", [])}
        body    = self._extract_body(msg["payload"])

        return {
            "message_id": message_id,
            "from":       headers.get("From", ""),
            "to":         headers.get("To", ""),
            "subject":    headers.get("Subject", ""),
            "date":       headers.get("Date", ""),
            "body":       body,
            "snippet":    msg.get("snippet", ""),
        }

    def _extract_invoice(self, params: dict) -> dict:
        from app.core.config import get_settings
        from app.core.llm import chat_complete

        email = self._read_email(params)
        s     = get_settings()

        prompt = INVOICE_EXTRACTION_USER.format(
            from_=email["from"],
            subject=email["subject"],
            body=email["body"][:s.text_input_max_chars],
        )

        raw = chat_complete(
            system="You are a precise invoice data extractor. Return only valid JSON.",
            user=prompt,
            max_tokens=s.ai_tools_max_tokens,
        )

        raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
        raw = re.sub(r"\n?```\s*$", "", raw)
        invoice = json.loads(raw)

        return {**invoice, "email_id": params.get("message_id"), "from_email": email["from"]}

    def _search_emails(self, params: dict) -> dict:
        query       = params.get("query", "")
        max_results = int(params.get("max_results", 10))

        try:
            result = self.service.users().messages().list(
                userId="me", q=query, maxResults=max_results
            ).execute()
        except HttpError as e:
            raise RuntimeError(f"Gmail search_emails failed: {e}") from e

        messages = result.get("messages", [])
        emails   = []
        for msg in messages:
            meta = self.service.users().messages().get(
                userId="me", id=msg["id"], format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            ).execute()
            hdrs = {h.get("name", ""): h.get("value", "") for h in meta["payload"].get("headers", [])}
            emails.append({
                "id":      msg["id"],
                "from":    hdrs.get("From", ""),
                "subject": hdrs.get("Subject", ""),
                "date":    hdrs.get("Date", ""),
                "snippet": meta.get("snippet", ""),
            })

        return {"query": query, "emails": emails, "total": len(emails)}

    def _read_emails_batch(self, params: dict) -> dict:
        emails_raw = params.get("emails") or []
        email_ids  = params.get("email_ids") or []

        # If emails arrived as a JSON string (e.g. due to param resolution edge cases), parse it
        if isinstance(emails_raw, str):
            try:
                emails_raw = json.loads(emails_raw)
            except (json.JSONDecodeError, ValueError):
                emails_raw = []

        if emails_raw and not email_ids:
            email_ids = [e["id"] if isinstance(e, dict) else e for e in emails_raw]

        if not email_ids:
            return {
                "emails": [],
                "total": 0,
                "combined_text": "",
            }

        results: list[dict] = []
        for msg_id in email_ids:
            try:
                results.append(self._read_email({"message_id": msg_id}))
            except Exception as e:
                results.append({"message_id": msg_id, "error": str(e)})

        parts: list[str] = []
        for i, email in enumerate(results, 1):
            if email.get("error"):
                parts.append(f"Email {i}: [Error: {email['error']}]")
            else:
                body = email.get("body") or email.get("snippet", "")
                # Always include subject + body so LLM has full context even for short emails
                parts.append(
                    f"Email {i}\n"
                    f"From: {email.get('from', 'Unknown')}\n"
                    f"Subject: {email.get('subject', '')}\n"
                    f"Date: {email.get('date', '')}\n"
                    f"---\n{body}"
                )

        return {
            "emails":        results,
            "total":         len(results),
            "combined_text": "\n\n".join(parts),
        }

    def _get_attachments(self, params: dict) -> dict:
        message_id = params.get("message_id")
        if not message_id:
            raise ValueError("'message_id' is required for get_attachments")

        try:
            msg = self.service.users().messages().get(
                userId="me", id=message_id, format="full"
            ).execute()
        except HttpError as e:
            raise RuntimeError(f"Gmail get_attachments failed: {e}") from e

        attachments: list[dict] = []
        self._collect_attachments(msg["payload"], attachments)
        return {"message_id": message_id, "attachments": attachments, "total": len(attachments)}

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _extract_body(self, payload: dict) -> str:
        mime = payload.get("mimeType", "")
        data = payload.get("body", {}).get("data", "")

        # Single-part text/plain
        if mime.startswith("text/plain") and data:
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

        # Single-part text/html (e.g. simple transactional emails with no multipart wrapper)
        if mime.startswith("text/html") and data:
            raw = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
            return self._strip_html(raw)

        # Multipart — recurse into parts
        plain, html = "", ""
        for part in payload.get("parts", []):
            part_mime = part.get("mimeType", "")
            part_data = part.get("body", {}).get("data")
            if part_mime == "text/plain" and part_data and not plain:
                plain = base64.urlsafe_b64decode(part_data).decode("utf-8", errors="replace")
            elif part_mime == "text/html" and part_data and not html:
                raw = base64.urlsafe_b64decode(part_data).decode("utf-8", errors="replace")
                html = self._strip_html(raw)
            elif part_mime.startswith("multipart/"):
                nested = self._extract_body(part)
                if nested and not plain:
                    plain = nested

        return plain or html or ""

    @staticmethod
    def _strip_html(html: str) -> str:
        """Remove HTML tags and collapse whitespace for clean LLM input."""
        text = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"&nbsp;", " ", text)
        text = re.sub(r"&amp;", "&", text)
        text = re.sub(r"&lt;", "<", text)
        text = re.sub(r"&gt;", ">", text)
        return re.sub(r"\s+", " ", text).strip()

    def _collect_attachments(self, payload: dict, result: list) -> None:
        if payload.get("filename"):
            result.append({
                "name":          payload["filename"],
                "mime_type":     payload["mimeType"],
                "size_bytes":    payload.get("body", {}).get("size", 0),
                "attachment_id": payload.get("body", {}).get("attachmentId"),
            })
        for part in payload.get("parts", []):
            self._collect_attachments(part, result)
