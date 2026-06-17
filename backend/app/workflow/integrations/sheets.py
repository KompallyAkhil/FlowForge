import json
import logging
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.workflow.integrations.base import BaseIntegration, ErrorCategory

logger = logging.getLogger(__name__)

SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _col_to_index(col: str) -> int:
    """Convert Excel column letters to 0-based index: A→0, Z→25, AA→26, AB→27."""
    result = 0
    for ch in col.upper():
        result = result * 26 + (ord(ch) - ord("A") + 1)
    return result - 1


class SheetsIntegration(BaseIntegration):

    def __init__(self) -> None:
        self._service = None

    # ── Auth ──────────────────────────────────────────────────────────────────

    @property
    def service(self):
        if self._service is None:
            self._service = build("sheets", "v4", credentials=self._credentials())
        return self._service

    def _credentials(self):
        # 1. DB credentials saved via the setup screen take priority
        try:
            from app.workflow.integrations.credential_store import get_integration_credentials
            data = get_integration_credentials("sheets")
            if data and data.get("refresh_token"):
                from google.oauth2.credentials import Credentials
                return Credentials(
                    token=None,
                    refresh_token=data["refresh_token"],
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=data["client_id"],
                    client_secret=data["client_secret"],
                    scopes=SHEETS_SCOPES,
                )
        except Exception as e:
            logger.warning("Failed to load Sheets credentials from DB, falling back to .env: %s", e)

        # 2. Fall back to env-var credentials
        from app.core.config import get_settings
        s = get_settings()

        if s.google_service_account_json:
            from google.oauth2 import service_account
            info = json.loads(s.google_service_account_json)
            return service_account.Credentials.from_service_account_info(
                info, scopes=SHEETS_SCOPES
            )

        if s.google_refresh_token:
            from google.oauth2.credentials import Credentials
            return Credentials(
                token=None,
                refresh_token=s.google_refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=s.google_client_id,
                client_secret=s.google_client_secret,
                scopes=SHEETS_SCOPES,
            )

        raise RuntimeError(
            "Google Sheets is not connected. Go to the setup screen to sign in with Google, "
            "or set GOOGLE_REFRESH_TOKEN in backend/.env"
        )

    @staticmethod
    def _normalize_params(params: dict) -> dict:
        """Translate LLM-generated Google-API-style keys into FlowForge's param schema.

        LLMs sometimes emit the raw Google Sheets REST API format:
          spreadsheetId / range / values: [[...]]
        instead of FlowForge's format:
          sheet / values: [...]
        This normalizer bridges the gap so both forms work.
        """
        p = dict(params)
        # spreadsheetId (camelCase) → spreadsheet_id
        if "spreadsheetId" in p and "spreadsheet_id" not in p:
            p["spreadsheet_id"] = p.pop("spreadsheetId")
        # Extract sheet name from a "range" like "Sheet1!A1" or "Sheet1"
        if "range" in p and "sheet" not in p:
            range_val: str = p.pop("range", "") or ""
            p["sheet"] = range_val.split("!")[0] if "!" in range_val else (range_val or "Sheet1")
        elif "range" in p:
            p.pop("range")  # already have "sheet"; drop redundant range
        return p

    _PLACEHOLDER_IDS = {"your_spreadsheet_id", "your-spreadsheet-id", "spreadsheet_id", "<spreadsheet_id>"}

    def _spreadsheet_id(self, params: dict) -> str:
        from app.core.config import get_settings
        sid = params.get("spreadsheet_id")
        if sid and sid.lower() in self._PLACEHOLDER_IDS:
            sid = None
        sid = sid or get_settings().sheets_spreadsheet_id
        if not sid:
            raise ValueError(
                "No spreadsheet_id provided. Pass it in params or set SHEETS_SPREADSHEET_ID in .env"
            )
        return sid

    # ── Dispatch (required by BaseIntegration) ────────────────────────────────

    def _dispatch(self, action: str, params: dict[str, Any]) -> dict[str, Any]:
        handlers = {
            "append_row":           self._append_row,
            "append_rows":          self._append_rows,
            "read_rows":            self._read_rows,
            "update_cell":          self._update_cell,
            "create_sheet":         self._create_sheet,
            "search_rows":          self._search_rows,
            "get_spreadsheet_info": self._get_spreadsheet_info,
        }
        if action not in handlers:
            raise ValueError(
                f"Sheets does not support action '{action}'. Available: {list(handlers)}"
            )
        return handlers[action](self._normalize_params(params))

    # ── Error classification ──────────────────────────────────────────────────

    def _classify_error(self, exc: Exception) -> ErrorCategory:
        # Action methods wrap HttpError in RuntimeError — unwrap __cause__ to get the status code
        http_err = exc if isinstance(exc, HttpError) else getattr(exc, "__cause__", None)
        if isinstance(http_err, HttpError):
            status = http_err.resp.status
            err_str = str(http_err).lower()
            if status == 401:
                return ErrorCategory.AUTH
            if status == 403:
                # Scope / permission errors cannot be recovered — fail immediately
                if "insufficient" in err_str or "scope" in err_str or "permission" in err_str:
                    return ErrorCategory.FATAL
                return ErrorCategory.AUTH
            if status == 429:
                return ErrorCategory.RATE_LIMIT
            if status == 404:
                return ErrorCategory.FIXABLE
            if status == 400:
                if "unable to parse range" in err_str or "parse range" in err_str:
                    return ErrorCategory.FIXABLE
                return ErrorCategory.UNKNOWN
            if status in (500, 503):
                return ErrorCategory.UNKNOWN
        return ErrorCategory.UNKNOWN

    # ── Pure-Python fixable recovery ──────────────────────────────────────────

    def _recover_fixable(self, action: str, params: dict, exc: Exception) -> dict:
        """
        When a sheet name can't be parsed (400 "Unable to parse range"),
        list the real sheet tabs and retry with the closest match.
        """
        http_err = exc if isinstance(exc, HttpError) else getattr(exc, "__cause__", None)
        if not (isinstance(http_err, HttpError) and http_err.resp.status == 400):
            raise exc

        bad_sheet = params.get("sheet", "")
        spreadsheet_id = self._spreadsheet_id(params)

        try:
            meta = self.service.spreadsheets().get(
                spreadsheetId=spreadsheet_id,
                fields="sheets.properties.title",
            ).execute()
        except HttpError:
            raise exc

        titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
        if not titles:
            raise exc

        # Pick the closest tab: exact match first, then case-insensitive, then first tab
        lower = bad_sheet.lower()
        matched = (
            next((t for t in titles if t == bad_sheet), None)
            or next((t for t in titles if t.lower() == lower), None)
            or next((t for t in titles if lower in t.lower()), None)
            or titles[0]
        )

        corrected_params = {**params, "sheet": matched}
        # Also fix the range if it was built from the bad sheet name
        if "range" in corrected_params and bad_sheet in corrected_params["range"]:
            corrected_params["range"] = corrected_params["range"].replace(bad_sheet, matched, 1)

        return self._dispatch(action, corrected_params)

    # ── Agent tools (exposed to the LangGraph agent) ─────────────────────────

    def get_agent_tools(self) -> list:
        from langchain_core.tools import tool
        from typing import Annotated as Ann
        _self = self

        @tool
        def sheets_append_row(
            values: Ann[list, "List of values to append as a new row, e.g. ['Alice', '100', '2026-06-14']"],
            sheet: Ann[str, "Sheet tab name (default: Sheet1)"] = "Sheet1",
        ) -> dict:
            """Append a new row to a Google Sheet. Only call if user asked to save/log to Sheets."""
            return _self.execute("append_row", {"sheet": sheet, "values": values})

        @tool
        def sheets_read_rows(
            sheet: Ann[str, "Sheet tab name (default: Sheet1)"] = "Sheet1",
        ) -> dict:
            """Read all rows from a Google Sheet."""
            return _self.execute("read_rows", {"sheet": sheet})

        @tool
        def sheets_update_cell(
            cell: Ann[str, "Cell reference, e.g. 'A1' or 'B3'"],
            value: Ann[str, "New value to set in the cell"],
            sheet: Ann[str, "Sheet tab name (default: Sheet1)"] = "Sheet1",
        ) -> dict:
            """Update a single cell in a Google Sheet."""
            return _self.execute("update_cell", {"sheet": sheet, "cell": cell, "value": value})

        @tool
        def sheets_search_rows(
            query: Ann[str, "Search term to filter rows by"],
            sheet: Ann[str, "Sheet tab name (default: Sheet1)"] = "Sheet1",
        ) -> dict:
            """Search for rows in a Google Sheet that match the query."""
            return _self.execute("search_rows", {"sheet": sheet, "query": query})

        @tool
        def sheets_get_spreadsheet_info() -> dict:
            """List all sheet tabs in the configured spreadsheet. Use this to find the correct tab name when the user mentions a named section."""
            return _self.execute("get_spreadsheet_info", {})

        return [sheets_append_row, sheets_read_rows, sheets_update_cell, sheets_search_rows, sheets_get_spreadsheet_info]

    def get_planner_spec(self) -> dict:
        return {
            "name": "sheets",
            "use_case": "reading/writing Google Sheets rows",
            "output_keywords": ['"save to Sheets"', '"log to Sheets"', '"add to spreadsheet"', '"track in sheets"'],
            "planner_notes": (
                "append_row values must be a flat list of simple values, never a dict or nested object.\n"
                "Always use ${today} for today's date — never write a hardcoded date string.\n"
                "  Correct:   values: [\"${today}\", 78.3]\n"
                "  Wrong:     values: [\"2026-06-15\", 78.3]\n"
                "If the user names a sheet section (e.g. \"weight tracking\" or \"budget tab\"), set \"sheet\" to the closest tab name.\n"
                "If no section is named, default to \"Sheet1\"."
            ),
            "chaining_examples": [
                {
                    "description": "Read Sheets data, summarize it, and send to Slack",
                    "steps": [
                        {"integration": "sheets", "action": "read_rows",     "params": {"sheet": "Sheet1"}},
                        {"integration": "ai",     "action": "summarize",     "params": {"text": "${step_1.rows}"}},
                        {"integration": "slack",  "action": "send_message",  "params": {"channel": "#general", "text": "${step_2.summary}"}},
                    ],
                },
                {
                    "description": "Read Sheets data, summarize it, and send by email",
                    "steps": [
                        {"integration": "sheets", "action": "read_rows",    "params": {"sheet": "Sheet1"}},
                        {"integration": "ai",     "action": "summarize",    "params": {"text": "${step_1.rows}"}},
                        {"integration": "gmail",  "action": "send_email",   "params": {"to": "recipient@example.com", "subject": "Sheet Summary", "body": "${step_2.summary}"}},
                    ],
                },
            ],
            "agent_strategy": (
                "- Sheets output: sheets_append_row — only when explicitly requested\n"
                "- NEVER include 'spreadsheet_id' or 'range' in any Sheets step params — both are auto-resolved"
            ),
            "actions": [
                {
                    "name": "get_spreadsheet_info",
                    "params": {},
                    "output": {
                        "spreadsheet_id": "...",
                        "title": "My Spreadsheet",
                        "sheets": [{"title": "Sheet1"}, {"title": "Weight Tracking"}],
                        "total_sheets": 2,
                    },
                    "output_note": (
                        "→ Optional discovery step. Returns all tab names so you can see what exists. "
                        "For most write operations, just set 'sheet' to your best guess of the tab name — "
                        "the engine auto-corrects tab names that don't match exactly."
                    ),
                },
                {
                    "name": "append_row",
                    "params": {"sheet": "Sheet1", "values": ["col1_value", "col2_value"]},
                    "output": {"status": "appended", "updated_range": "Sheet1!A2"},
                    "output_note": (
                        "→ 'values' must be a flat list of scalars — one item per column.\n"
                        "  Date example: values: [\"2026-06-15\", 78.3] — use CURRENT DATE constant for 'today'.\n"
                        "  For invoice data: values: [${step_2.vendor}, ${step_2.invoice_number}, "
                        "${step_2.amount}, ${step_2.currency}, ${step_2.due_date}]\n"
                        "  NEVER pass a whole dict or nested object as a value.\n"
                        "  NEVER include 'spreadsheet_id' in params — it is auto-configured from the environment.\n"
                        "  NEVER include 'range' in params — the engine computes the range from 'sheet'."
                    ),
                },
                {"name": "append_rows",          "params": {"sheet": "Sheet1", "rows": "${step_N.field}", "fields": ["name"]},        "output": None},
                {
                    "name": "read_rows",
                    "params": {"sheet": "Sheet1"},
                    "output": {
                        "rows":       [["Header1", "Header2"], ["val1", "val2"]],
                        "headers":    ["Header1", "Header2"],
                        "total_rows": 2,
                        "range":      "Sheet1!A1:B2",
                    },
                    "output_note": (
                        "→ Use ${step_N.rows} to pass all rows to a downstream step.\n"
                        "  rows is a list-of-lists (first row is the header).\n"
                        "  Pass directly to slack.send_message or ai.summarize:\n"
                        "    slack: text: \"${step_N.rows}\"  — engine formats as a readable table\n"
                        "    ai:    text: \"${step_N.rows}\"  — converted automatically"
                    ),
                },
                {"name": "update_cell",          "params": {"sheet": "Sheet1", "cell": "A1", "value": "new value"},                  "output": None},
                {"name": "search_rows",          "params": {"sheet": "Sheet1", "query": "search term"},                              "output": None},
                {"name": "create_sheet",         "params": {"name": "new-tab-name"},                                                  "output": None},
            ],
        }

    def get_configured_resources(self) -> list[tuple[str, str]]:
        from app.core.config import get_settings
        s = get_settings()
        resources: list[tuple[str, str]] = [("Default sheet tab", "Sheet1")]
        if s.sheets_spreadsheet_id:
            resources.append(("Google Sheets spreadsheet ID", s.sheets_spreadsheet_id))
        return resources

    # ── Discovery tools for LangGraph recovery agent ──────────────────────────

    def _get_recovery_tools(self) -> list:
        from langchain_core.tools import tool

        service_ref = self.service
        sid_ref     = self._spreadsheet_id

        @tool
        def list_sheet_names(spreadsheet_id: str = "") -> str:
            """
            List all sheet (tab) names in a Google Spreadsheet.
            Returns a JSON object with the spreadsheet_id and a list of sheet names.
            Use this to find the correct sheet name when a range parse error occurs.

            Args:
                spreadsheet_id: The Google Sheets spreadsheet ID. Leave empty to use
                                the default configured spreadsheet.
            """
            try:
                if not spreadsheet_id:
                    from app.core.config import get_settings
                    spreadsheet_id = get_settings().sheets_spreadsheet_id or ""
                if not spreadsheet_id:
                    return json.dumps({"error": "No spreadsheet_id available"})

                meta = service_ref.spreadsheets().get(
                    spreadsheetId=spreadsheet_id,
                    fields="sheets.properties.title,sheets.properties.sheetId",
                ).execute()
                sheets = [
                    {"title": s["properties"]["title"], "id": s["properties"]["sheetId"]}
                    for s in meta.get("sheets", [])
                ]
                return json.dumps({"spreadsheet_id": spreadsheet_id, "sheets": sheets})
            except Exception as e:
                return json.dumps({"error": str(e)})

        return [list_sheet_names]

    # ── Actions ───────────────────────────────────────────────────────────────

    def _get_spreadsheet_info(self, params: dict) -> dict:
        spreadsheet_id = self._spreadsheet_id(params)
        try:
            meta = self.service.spreadsheets().get(
                spreadsheetId=spreadsheet_id,
                fields="spreadsheetId,properties.title,sheets.properties",
            ).execute()
        except HttpError as e:
            raise RuntimeError(f"Sheets get_spreadsheet_info failed: {e}") from e

        sheets = [
            {
                "title":    s["properties"]["title"],
                "sheet_id": s["properties"]["sheetId"],
                "index":    s["properties"]["index"],
                "row_count":    s["properties"].get("gridProperties", {}).get("rowCount", 0),
                "column_count": s["properties"].get("gridProperties", {}).get("columnCount", 0),
            }
            for s in meta.get("sheets", [])
        ]
        return {
            "spreadsheet_id": meta.get("spreadsheetId", spreadsheet_id),
            "title":          meta.get("properties", {}).get("title", ""),
            "sheets":         sheets,
            "total_sheets":   len(sheets),
        }

    def _append_row(self, params: dict) -> dict:
        spreadsheet_id = self._spreadsheet_id(params)
        sheet  = params.get("sheet", "Sheet1")
        values = params.get("values")

        if not values and params.get("row"):
            row    = params["row"]
            values = list(row.values()) if isinstance(row, dict) else row

        if not values:
            raise ValueError("'values' list is required for append_row")

        # Normalise values type so downstream code always gets a list
        if isinstance(values, str):
            values = [values]
        elif isinstance(values, dict):
            values = list(values.values())

        # Normalise: ensure we have a list-of-lists; convert every cell to a safe scalar
        def _safe(v: Any) -> Any:
            if v is None:
                return ""
            if isinstance(v, (dict, list)):
                return json.dumps(v)
            return v

        if isinstance(values[0], list):
            rows_to_write = [[_safe(c) for c in row] for row in values]
        else:
            rows_to_write = [[_safe(c) for c in values]]

        range_name = f"{sheet}!A1"
        body       = {"values": rows_to_write}

        try:
            result = (
                self.service.spreadsheets()
                .values()
                .append(
                    spreadsheetId=spreadsheet_id,
                    range=range_name,
                    valueInputOption="USER_ENTERED",
                    insertDataOption="INSERT_ROWS",
                    body=body,
                )
                .execute()
            )
        except HttpError as e:
            raise RuntimeError(f"Sheets append_row failed: {e}") from e

        updates = result.get("updates", {})
        return {
            "status":         "appended",
            "spreadsheet_id": spreadsheet_id,
            "sheet":          sheet,
            "updated_range":  updates.get("updatedRange", ""),
            "updated_rows":   updates.get("updatedRows", 0),
        }

    def _append_rows(self, params: dict) -> dict:
        """Write multiple rows at once from a list, array ref, or JSON string."""
        spreadsheet_id = self._spreadsheet_id(params)
        sheet = params.get("sheet", "Sheet1")

        # Accept the data under several common param names
        data = (
            params.get("rows")
            or params.get("array")
            or params.get("data")
            or params.get("values")
        )

        # If the execution engine resolved ${step_N.x} to a JSON string, parse it back
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                data = [data]

        if not data:
            raise ValueError("'rows' is required for append_rows — pass a list of values or objects")

        field  = params.get("field")    # single field to extract, e.g. "name"
        fields = params.get("fields")   # multiple fields as columns, e.g. ["name", "id"]

        def _safe(v: Any) -> Any:
            if v is None:
                return ""
            if isinstance(v, (dict, list)):
                return json.dumps(v)
            return str(v)

        rows_to_write: list[list] = []
        for item in data:
            if isinstance(item, dict):
                if fields:
                    row = [_safe(item.get(f, "")) for f in fields]
                elif field:
                    row = [_safe(item.get(field, ""))]
                else:
                    row = [_safe(v) for v in item.values()]
            elif isinstance(item, list):
                row = [_safe(v) for v in item]
            else:
                row = [_safe(item)]
            rows_to_write.append(row)

        if not rows_to_write:
            raise ValueError("No rows to write — data resolved to an empty list")

        range_name = f"{sheet}!A1"
        body = {"values": rows_to_write}

        try:
            result = (
                self.service.spreadsheets()
                .values()
                .append(
                    spreadsheetId=spreadsheet_id,
                    range=range_name,
                    valueInputOption="USER_ENTERED",
                    insertDataOption="INSERT_ROWS",
                    body=body,
                )
                .execute()
            )
        except HttpError as e:
            raise RuntimeError(f"Sheets append_rows failed: {e}") from e

        updates = result.get("updates", {})
        return {
            "status":        "appended",
            "spreadsheet_id": spreadsheet_id,
            "sheet":          sheet,
            "rows_written":   len(rows_to_write),
            "updated_range":  updates.get("updatedRange", ""),
        }

    def _read_rows(self, params: dict) -> dict:
        spreadsheet_id = self._spreadsheet_id(params)
        sheet      = params.get("sheet", "Sheet1")
        range_expr = params.get("range", f"{sheet}")   # no column/row limit — Sheets returns all data
        if "!" not in range_expr and not range_expr.startswith("'"):
            range_expr = sheet                          # use sheet name only → full extent

        try:
            result = (
                self.service.spreadsheets()
                .values()
                .get(
                    spreadsheetId=spreadsheet_id,
                    range=range_expr,
                    valueRenderOption="FORMATTED_VALUE",
                )
                .execute()
            )
        except HttpError as e:
            raise RuntimeError(f"Sheets read_rows failed: {e}") from e

        rows = result.get("values", [])
        headers = rows[0] if rows else []
        return {
            "spreadsheet_id": spreadsheet_id,
            "range":          result.get("range", range_expr),
            "headers":        headers,
            "rows":           rows,
            "total_rows":     len(rows),
        }

    def _update_cell(self, params: dict) -> dict:
        spreadsheet_id = self._spreadsheet_id(params)
        sheet = params.get("sheet", "Sheet1")
        cell  = params.get("cell")
        value = params.get("value")

        if not cell:
            raise ValueError("'cell' is required for update_cell (e.g. 'A1')")

        range_expr = f"{sheet}!{cell}"
        body       = {"values": [[value]]}

        try:
            result = (
                self.service.spreadsheets()
                .values()
                .update(
                    spreadsheetId=spreadsheet_id,
                    range=range_expr,
                    valueInputOption="USER_ENTERED",
                    body=body,
                )
                .execute()
            )
        except HttpError as e:
            raise RuntimeError(f"Sheets update_cell failed: {e}") from e

        return {
            "status":         "updated",
            "spreadsheet_id": spreadsheet_id,
            "updated_range":  result.get("updatedRange", range_expr),
            "new_value":      value,
        }

    def _create_sheet(self, params: dict) -> dict:
        spreadsheet_id = self._spreadsheet_id(params)
        name = params.get("name")
        if not name:
            raise ValueError("'name' is required for create_sheet")

        body = {"requests": [{"addSheet": {"properties": {"title": name}}}]}

        try:
            result = self.service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id, body=body
            ).execute()
        except HttpError as e:
            raise RuntimeError(f"Sheets create_sheet failed: {e}") from e

        added = result["replies"][0]["addSheet"]["properties"]
        return {
            "status":         "created",
            "spreadsheet_id": spreadsheet_id,
            "sheet_id":       added["sheetId"],
            "name":           added["title"],
        }

    def _search_rows(self, params: dict) -> dict:
        all_data = self._read_rows(params)
        query    = str(params.get("query", "")).lower()
        column   = params.get("column")
        rows     = all_data["rows"]

        # Treat row 0 as headers if it exists
        headers  = rows[0] if rows else []
        data_rows = rows[1:] if len(rows) > 1 else []

        matches = []
        for i, row in enumerate(data_rows, start=1):   # 1-indexed (row 0 = header)
            if not any(cell for cell in row):           # skip fully empty rows
                continue
            if column is not None:
                col_idx    = int(column) if str(column).isdigit() else _col_to_index(str(column))
                cell_value = str(row[col_idx]).lower() if col_idx < len(row) else ""
                hit        = query in cell_value
            else:
                hit = any(query in str(cell).lower() for cell in row)

            if hit:
                # Zip with headers to return {column_name: value} dict when possible
                row_dict = dict(zip(headers, row)) if headers else {}
                matches.append({
                    "row_index": i,
                    "data":      row,
                    "record":    row_dict,
                })

        return {
            "spreadsheet_id": all_data["spreadsheet_id"],
            "sheet":          params.get("sheet", "Sheet1"),
            "headers":        headers,
            "query":          query,
            "matches":        matches,
            "total_matches":  len(matches),
        }
