# FlowForge — AI Workflow Automation Platform

Full-stack AI automation platform that converts natural language into executable multi-step workflows. Users describe what they want to automate; an LLM planner generates the workflow definition; users review and modify it before running.

---

## Architecture

```
Giridhar_Aiden_AI/
├── backend/          FastAPI + SQLAlchemy + SQLite
│   └── app/
│       ├── main.py           App factory, CORS, router registration, lifespan
│       ├── database.py       SQLAlchemy engine, SessionLocal, init_db()
│       ├── prompts.py        All LLM system prompts + PLANNER_CHAINING_RULES
│       ├── api/              Chat, memory, tools, integrations modules
│       │   └── integrations.py   /api/integrations/* — OAuth + Slack token + status
│       ├── core/config.py    Settings via pydantic-settings
│       ├── scheduler/        APScheduler-based cron for scheduled workflows
│       ├── services/         Shared utilities
│       └── workflow/
│           ├── db_models.py      ORM models (incl. IntegrationCredential)
│           ├── schemas.py        Pydantic request/response schemas
│           ├── planner/          LLM → WorkflowJson via structured output
│           ├── agent/            LangGraph failure-recovery agent (step-failure rescue only)
│           ├── engine/
│           │   ├── workflow_engine.py   CRUD + version snapshots + diff
│           │   └── execution_engine.py  Step runner + retry + log writing
│           ├── integrations/
│           │   ├── base.py              BaseIntegration + IntegrationRegistry + ErrorCategory
│           │   ├── credential_store.py  DB-backed credential lookup/upsert/delete
│           │   ├── generic.py           HTTP/generic steps
│           │   ├── gmail.py             search_emails, read_emails_batch, send_email
│           │   ├── slack.py             send_message, read_messages
│           │   ├── sheets.py            read_sheet, write_sheet, append_row, append_rows
│           │   └── ai_tools.py          summarize, extract, transform
│           └── api/
│               ├── workflow_router.py    /api/workflows/*
│               ├── execution_router.py  /api/executions/*
│               └── agent_router.py      /api/agent/runs/*
└── frontend/         Next.js (App Router) + TypeScript, inline styles only
    ├── app/
    │   ├── page.tsx           Root page — Home gating + WorkflowApp + WfView state machine
    │   ├── layout.tsx
    │   └── agent/             Separate LangGraph agent chat UI
    ├── components/
    │   ├── workflow/
    │   │   ├── integration-setup.tsx  First-run credential setup screen (gating)
    │   │   ├── step-card.tsx          Read-only step display with edit/delete/reorder
    │   │   ├── step-editor.tsx        Full step edit/add form with INT_CATALOG
    │   │   ├── review-view.tsx        Workflow review panel (modify + approve)
    │   │   ├── execution-view.tsx     Live execution progress + live error display
    │   │   ├── done-view.tsx          Post-execution summary
    │   │   ├── history-panel.tsx      Execution history list
    │   │   ├── version-history-panel.tsx  Workflow version snapshots + structured diff
    │   │   ├── integration-cards.tsx  Integration tile selector
    │   │   ├── schedule-panel.tsx     Cron schedule management
    │   │   └── param-editor.tsx       Legacy simple param editor (kept for reference)
    │   └── ui/                Spinner, shared primitives
    ├── lib/
    │   ├── api.ts             All fetch calls to backend
    │   ├── types.ts           All TypeScript interfaces
    │   └── utils.ts           C (design tokens), fmtDate, etc.
    └── CLAUDE.md              Next.js version caveat (@AGENTS.md)
```

---

## Backend

### Database — no Alembic

Schema is managed via `Base.metadata.create_all()` on startup and a `_migrate_schema()` helper in `database.py` that issues `ALTER TABLE` for columns added after initial deploy. Never use Alembic here.

### ORM Models (`workflow/db_models.py`)

| Model | Key columns |
|---|---|
| `Workflow` | `id`, `name`, `original_input`, `workflow_json` (JSON), `schedule_enabled`, `schedule_timezone`, `updated_at` |
| `WorkflowVersion` | `id`, `workflow_id` (FK), `version_number`, `workflow_json` (full snapshot), `change_summary` (text), `changed_fields` (JSON), `created_at` |
| `Execution` | `id`, `workflow_id`, `status`, `current_step`, `error`, `started_at`, `completed_at` |
| `ExecutionLog` | `id`, `execution_id`, `step_index`, `step_name`, `integration`, `action`, `status`, `input_data`, `output_data`, `error`, `retry_count` |
| `IntegrationCredential` | `id`, `integration` (unique), `credential_data` (JSON), `status`, `connected_at`, `updated_at` |

`Workflow` has a `versions` relationship to `WorkflowVersion`.

### Dynamic Integration Credentials

Integration tokens (Google OAuth, Slack bot token) are stored in the `IntegrationCredential` DB table rather than `.env`. The shared helper `workflow/integrations/credential_store.py` provides:

- `get_integration_credentials(integration)` — returns `credential_data` dict or `None`
- `save_integration_credentials(integration, data)` — upserts credential record
- `delete_integration_credentials(integration)` — removes credential record

Each adapter (gmail, slack, sheets) checks the DB first via `credential_store`, then falls back to `.env` values for backward compatibility. This means `.env` credential vars are optional once the user connects via the setup UI.

**Google OAuth note:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` remain in `.env` as app-level OAuth credentials. User-specific access/refresh tokens go into the DB under integration names `"gmail"` and `"sheets"` (both saved by a single Google sign-in). `OAUTHLIB_INSECURE_TRANSPORT=1` is set programmatically in the OAuth route for local HTTP development.

### Versioning (`workflow_engine.py`)

- `create_workflow` → saves version 1, `change_summary="Initial creation"`
- `update_workflow` → calls `_compute_diff(old_name, old_json, new_name, new_def)` **before** applying changes, saves new version after
- `_compute_diff` returns `(str summary, list[dict] changed_fields)` covering: name rename, step added/removed, step renamed, step action changed, step params changed, steps reordered
- `list_versions(db, workflow_id)` → newest first

### Execution engine (`execution_engine.py`)

3-layer failure recovery:
1. **Engine retry** — configurable `max_retries` per step
2. **Rate-limit backoff** — exponential back-off on 429/rate-limit errors
3. **LangGraph agent** — AI agent in `workflow/agent/` attempts to fix/route around persistent failures

Writes an `ExecutionLog` row per step with `status`, `error`, `retry_count`, `input_data`, `output_data`.

#### Step-output chaining (`_resolve_params`)

`${step_N.field}` references in params are resolved in two passes before each step runs:

- **Pass 1** — regex `r'"\$\{([^}]+)\}"'`: replaces a param value that is *entirely* a reference (e.g., `"emails": "${step_1.emails}"`). The surrounding quotes are removed so lists and dicts arrive as real Python types, not JSON strings.
- **Pass 2** — regex `r'\$\{([^}]+)\}'`: inline replacement for references embedded inside larger strings (e.g., `"text": "Summary: ${step_3.summary}"`).

`_assert_no_unresolved_refs` runs after both passes and only flags `${step_N.field}` patterns (regex: `r'\$\{(step_[^}]+)\}'`), so `${variable}` inside email body content is never a false positive.

### Integrations

Only these integrations are registered (in `workflow/integrations/__init__.py`): `gmail`, `slack`, `sheets`, `ai`, `generic`. No agent-wrapper integrations exist.

Each file in `workflow/integrations/` exports an adapter class:
- `gmail.py` — `search_emails`, `read_emails_batch`, `send_email` (reads tokens from DB via `credential_store`, falls back to `.env`). Empty `email_ids`/`emails` list returns gracefully instead of raising.
- `slack.py` — `send_message`, `read_messages` (`client` property always does a fresh DB lookup — no caching — so connect/disconnect takes effect immediately)
- `sheets.py` — `read_sheet`, `write_sheet`, `append_row`, `append_rows` (bulk write, same DB-first pattern)
- `ai_tools.py` — `summarize`, `extract`, `transform`. Empty text input returns a graceful result instead of raising.
- `generic.py` — HTTP/generic steps

### Workflow Planner (`planner/llm_planner.py`)

`plan_workflow(natural_language)` dispatches based on `settings.ai_provider`:
- `"groq"` → `_call_groq()` using `AsyncGroq`
- `"anthropic"` → `_call_anthropic()` using `AsyncAnthropic`
- `settings.use_mock_ai=True` → returns `_MOCK_WORKFLOW` (3-step invoice workflow, no LLM call)

The system prompt (`_SYSTEM_PROMPT_TEMPLATE`) encodes strict integration/action allowlists, step-output chaining syntax (`${step_N.field}`), cron conversion rules, and output-step gating rules (only add Slack/email steps when user explicitly requests it).

`_parse_llm_output` strips markdown fences, parses JSON, validates integrations against `IntegrationRegistry`, and strips `integration.` prefixes from action names if the LLM includes them.

#### `prompts.py` — `PLANNER_CHAINING_RULES`

Explicit multi-step patterns that teach the LLM correct step numbering:

| Pattern | Description |
|---|---|
| A | `search_emails` → `read_emails_batch` → `ai.summarize` |
| B | `search_emails` → `read_emails_batch` → `ai.summarize` → `slack.send_message` |
| C | `search_emails` → `read_emails_batch` → `ai.summarize` → `sheets.append_row` |
| D | `search_emails` → `read_emails_batch` → `slack.send_message` + `sheets.append_rows` (no summarize) |
| E | `search_emails` → `read_emails_batch` → `ai.summarize` → `slack.send_message` + `sheets.append_row` (5-step, both destinations reference `${step_3.summary}`) |

`PLANNER_OUTPUT_FORMAT` allowlist: `gmail | slack | sheets | ai | generic`.

### Scheduler

APScheduler (background in-process). Cron expression lives in `workflow_json.trigger.condition` (written by the LLM planner). `register_workflow_schedule` parses and registers the job; `load_scheduled_workflows` re-registers on startup.

### API routes

```
POST   /api/workflows/                    Plan + create workflow
GET    /api/workflows/                    List all
GET    /api/workflows/{id}
PUT    /api/workflows/{id}                Update (triggers new version snapshot)
DELETE /api/workflows/{id}
GET    /api/workflows/{id}/versions       Version history (newest first)
GET    /api/workflows/{id}/executions
POST   /api/workflows/{id}/execute        Starts background execution → 202
POST   /api/workflows/{id}/schedule/enable
POST   /api/workflows/{id}/schedule/disable
PUT    /api/workflows/{id}/schedule
GET    /api/workflows/{id}/schedule/status

GET    /api/executions/{id}
GET    /api/executions/{id}/logs          Per-step logs
POST   /api/executions/{id}/resume

GET    /api/integrations/status           List [{integration, connected, connected_at}]
GET    /api/integrations/google/connect   Redirect → Google OAuth consent screen
GET    /api/integrations/google/callback  Exchange code → save gmail+sheets tokens → close popup
POST   /api/integrations/slack            Validate + save Slack bot token {bot_token}
DELETE /api/integrations/{integration}    Disconnect (google removes both gmail+sheets)

GET    /health
```

---

## Frontend

### Styling

No CSS framework. All styles are inline objects. Design tokens live in `lib/utils.ts` as `C` (imported everywhere as `import { C } from "@/lib/utils"`):
- `C.canvas`, `C.surface`, `C.text`, `C.muted`, `C.subtle`
- `C.border`, `C.border2`
- `C.accent`, `C.accentL`, `C.info`, `C.success`, `C.warning`, `C.danger`

Never add Tailwind classes or CSS modules.

### App entry point — integration gating (`app/page.tsx`)

`Home` (default export) checks integration status on mount before rendering anything else:

```
Home
  └─ on mount: GET /api/integrations/status
       ├─ all connected → render <WorkflowApp />
       └─ any missing   → render <IntegrationSetup onComplete={...} />
```

`WorkflowApp` contains all original workflow UI (the WfView state machine, sidebar, panels). It is never rendered until all integrations are connected (or the user clicks "Skip for now").

### Integration setup screen (`components/workflow/integration-setup.tsx`)

Shown before the main UI when any integration is not connected. Three cards:

- **Gmail** — "Sign in with Google" opens a popup to `GET /api/integrations/google/connect`. Backend redirects through Google OAuth and the callback page posts `{type: "integration_connected", integration: "google"}` via `window.opener.postMessage()`. The setup component listens with `window.addEventListener("message", ...)` and polls `popup.closed` as a fallback.
- **Google Sheets** — shows "Connects automatically with Gmail" (shares the same Google OAuth flow; no separate action needed).
- **Slack** — text input for `xoxb-...` bot token; "Save Token" calls `POST /api/integrations/slack`.

"Continue to Workflows →" button enabled when all 3 are connected. "Skip for now" link also calls `onComplete()`. Connected count (X/3) shown below the button.

### WfView state machine (`WorkflowApp` in `app/page.tsx`)

The top-level `view` state drives which panel renders:

```
"create"   → Input form / workflow list sidebar
     ↓  (planWorkflow)
"review"   → WorkflowReviewView — inspect, modify, then approve
     ↓  (user clicks Approve & Run)
"executing" → ExecutionView — live polling every 1.5s
     ↓  (execution completes)
"done"     → DoneView — summary + next actions
```

**Critical:** The "▶ Run" button on existing saved workflows always routes to `"review"` first — never directly to `"executing"`. This ensures every execution is reviewed before it runs.

Sidebar panels (mutually exclusive toggles):
- **History** — past executions for the selected workflow
- **Versions** — workflow version history (calls `VersionHistoryPanel`)

### Execution polling (`execution-view.tsx`)

Polls every 1500ms using `Promise.all` for parallel status + logs fetch:
```ts
const [data, liveLogs] = await Promise.all([
  api.getExecution(executionId),
  api.getExecutionLogs(executionId).catch(() => []),
])
```

Live errors are surfaced via a warning banner during running state. Top-level failure panel shown when `ex.status === "failed"`.

### Step editor (`step-editor.tsx`)

`INT_CATALOG` maps each integration to its available actions and default params:
```
gmail  → send_email | read_email | extract_invoice | search_emails | get_attachments
slack  → send_message | get_messages | create_channel | post_notification | list_channels
sheets → append_row | append_rows | read_rows | update_cell | create_sheet | search_rows | get_spreadsheet_info
ai     → summarize | extract | transform
```

Action pills regenerate on integration change; params auto-fill from defaults. Works in both Add (no `step` prop) and Edit (`step` prop) mode. Calls `onSave(WorkflowStep)` callback.

### Version history (`version-history-panel.tsx`)

Fetches `GET /api/workflows/{id}/versions` and renders each version as a collapsible row showing:
- Version badge, change summary, timestamp, step count
- Expanded: structured `ChangeRow` items (NAME / ADDED / REMOVED / RENAMED / ACTION / PARAMS / REORDERED pills)
- Expanded: full step snapshot for that version
- PARAMS changes have a toggleable before/after JSON diff panel

### TypeScript types (`lib/types.ts`)

Key interfaces include `WorkflowJson`, `WorkflowStep`, `Execution`, `ExecutionLog`, `WorkflowVersion`, and:

```ts
interface IntegrationStatus {
  integration: "gmail" | "slack" | "sheets"
  connected: boolean
  connected_at: string | null
}
```

### API client (`lib/api.ts`)

All fetch calls go through `req<T>()` which handles error extraction and 204 responses. Integration-related helpers:
- `getIntegrationStatus()` → `GET /api/integrations/status`
- `saveSlackToken(bot_token)` → `POST /api/integrations/slack`
- `disconnectIntegration(name)` → `DELETE /api/integrations/{name}`

---

## Running the project

### Backend
```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm run dev   # http://localhost:3000
```

### Environment variables

Backend (`backend/.env`):
```
# AI provider — "groq" or "anthropic"
AI_PROVIDER=groq
USE_MOCK_AI=false       # set true to bypass LLM and return a hardcoded 3-step workflow
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
ANTHROPIC_API_KEY=...   # used when AI_PROVIDER=anthropic

CORS_ORIGINS=http://localhost:3000

# Google OAuth app credentials (stay in .env; user tokens go to DB)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Optional fallbacks — used if no DB credential exists for the integration
GOOGLE_REFRESH_TOKEN=...
SLACK_BOT_TOKEN=...
SLACK_DEFAULT_CHANNEL=#your-channel
SHEETS_SPREADSHEET_ID=...
```

Frontend (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Google OAuth local setup:** Add `http://localhost:8000/api/integrations/google/callback` to "Authorized redirect URIs" in Google Cloud Console → Credentials → OAuth 2.0 Client ID. The `OAUTHLIB_INSECURE_TRANSPORT=1` env var is set programmatically for local HTTP — do not set it in production.

**AI provider:** `get_settings()` uses `lru_cache`, so a server restart is required after editing `.env`. If the Groq key is invalid (401), switch to `AI_PROVIDER=anthropic` with a valid `ANTHROPIC_API_KEY`, or set `USE_MOCK_AI=true` to unblock UI testing without a real LLM.

---

## Key conventions

- Backend IDs are UUIDs (strings), generated at model creation with `default=lambda: str(uuid.uuid4())`
- `workflow_json` is stored as JSON in SQLite; TypeScript type is `WorkflowJson`
- All timestamps are UTC; frontend formats via `fmtDate()` from `lib/utils.ts`
- Pydantic v2: use `model_validate` (not `from_orm`), use `model_config = ConfigDict(from_attributes=True)`
- Never call `datetime.utcnow()` in new code — use `datetime.now(UTC)` (utcnow is deprecated in Python 3.12+). Pre-existing usages are grandfathered
- Frontend API calls all go through the `req<T>()` helper in `lib/api.ts` which handles error extraction and 204 responses
- Never store `.env` secrets in memory files or version control. Add `backend/.env` to `.gitignore`.
