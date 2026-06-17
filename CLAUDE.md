# FlowForge — AI Workflow Automation Platform

Full-stack AI automation platform that converts natural language into executable multi-step workflows. Users describe what they want to automate; an LLM planner generates the workflow definition; users review and modify it before running. Also includes a standalone LangGraph ReAct agent for free-form tool use.

---

## Architecture

```
Giridhar_Aiden_AI/
├── backend/          FastAPI + SQLAlchemy + SQLite
│   └── app/
│       ├── main.py           App factory, CORS, router registration, lifespan
│       ├── database.py       SQLAlchemy engine, SessionLocal, init_db(), _migrate_schema()
│       ├── prompts.py        All LLM system prompts + PLANNER_CHAINING_RULES
│       ├── api/
│       │   ├── integrations.py   /api/integrations/* — OAuth + Slack token + status
│       │   ├── chat.py           /api/chat/* — multi-turn chat assistant (Aiden)
│       │   ├── memory.py         /api/memory/* — session-scoped in-memory storage
│       │   └── tools.py          /api/tools/* — pluggable tool invocation
│       ├── core/
│       │   ├── config.py     Settings via pydantic-settings
│       │   └── llm.py        Shared LLM factory — chat_complete() + get_langchain_llm()
│       ├── models/
│       │   ├── chat.py       Chat / ChatMessage / ChatRequest / ChatResponse
│       │   ├── memory.py     MemoryItem, MemoryAddRequest, MemorySearchRequest/Response
│       │   └── tools.py      ToolCallResponse, ToolName
│       ├── services/
│       │   ├── ai_service.py     Async LLM reply generation for chat assistant
│       │   ├── memory_service.py In-memory session-scoped memory search/storage
│       │   └── tools_service.py  Tool dispatcher (currently: datetime_info)
│       ├── scheduler/        APScheduler-based cron for scheduled workflows
│       └── workflow/
│           ├── db_models.py      ORM models (Workflow, Execution, WorkflowVersion,
│           │                       ExecutionLog, IntegrationCredential)
│           ├── schemas.py        Pydantic request/response schemas
│           ├── planner/          LLM → WorkflowDefinition via dynamic prompt
│           ├── agent/
│           │   ├── agentic_runner.py  LangGraph ReAct agent — free-form tool use
│           │   ├── failure_agent.py   LangGraph failure-recovery agent (step rescue only)
│           │   ├── agent_db.py        AgentRun + AgentStep ORM models
│           │   └── tools.py           Tool definitions available to the agent
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
    │   │   ├── review-view.tsx        Workflow review panel (modify + approve/reject)
    │   │   ├── execution-view.tsx     Live execution progress + live error display
    │   │   ├── done-view.tsx          Post-execution summary
    │   │   ├── history-panel.tsx      Execution history list
    │   │   ├── version-history-panel.tsx  Workflow version snapshots + structured diff
    │   │   ├── integration-cards.tsx  Integration tile selector
    │   │   ├── schedule-panel.tsx     Cron schedule management
    │   │   ├── workflow-chat.tsx      In-workflow chat for step refinement
    │   │   └── param-editor.tsx       Legacy simple param editor (kept for reference)
    │   └── ui/
    │       ├── spinner.tsx     Loading spinner
    │       ├── button.tsx      Shared button primitive
    │       ├── badge.tsx       Status badge
    │       ├── dot.tsx         Status dot indicator
    │       └── int-chip.tsx    Integration icon chip (color-coded by integration name)
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
| `Workflow` | `id`, `name`, `original_input`, `workflow_json` (JSON), `explanation` (TEXT), `status` (`draft\|approved\|rejected`), `schedule_enabled`, `schedule_timezone`, `updated_at` |
| `WorkflowVersion` | `id`, `workflow_id` (FK), `version_number`, `name`, `workflow_json` (full snapshot), `change_summary` (text), `changed_fields` (JSON), `created_at` |
| `Execution` | `id`, `workflow_id`, `status` (`pending\|running\|success\|failed`), `current_step`, `error`, `started_at`, `completed_at` |
| `ExecutionLog` | `id`, `execution_id`, `step_index`, `step_name`, `integration`, `action`, `status`, `input_data`, `output_data`, `error`, `retry_count`, `updated_at` |
| `IntegrationCredential` | `id`, `integration` (unique), `credential_data` (JSON), `status`, `connected_at`, `updated_at` |

`Workflow` has `versions` and `executions` relationships.

#### Agent ORM models (`workflow/agent/agent_db.py`)

| Model | Key columns |
|---|---|
| `AgentRun` | `id`, `query`, `status` (`pending\|running\|success\|failed`), `final_answer`, `error`, `started_at`, `completed_at` |
| `AgentStep` | `id`, `run_id` (FK), `step_index`, `tool_name`, `tool_input` (JSON), `tool_output` (JSON), `status`, `created_at` |

### Workflow Lifecycle — `status` state machine

Every workflow starts as `"draft"` when created. Any `PUT /api/workflows/{id}` resets status back to `"draft"`. Approved → executes; rejected → must be edited to reset before re-approval.

```
"draft"  →  POST /approve  →  "approved"  →  execution starts
"draft"  →  POST /reject   →  "rejected"
"rejected" / "approved"  →  PUT (edit)  →  "draft"   (re-review required)
```

### Dynamic Integration Credentials

Integration tokens (Google OAuth, Slack bot token) are stored in the `IntegrationCredential` DB table rather than `.env`. The shared helper `workflow/integrations/credential_store.py` provides:

- `get_integration_credentials(integration)` — returns `credential_data` dict or `None`
- `save_integration_credentials(integration, data)` — upserts credential record
- `delete_integration_credentials(integration)` — removes credential record

Each adapter (gmail, slack, sheets) checks the DB first via `credential_store`, then falls back to `.env` values for backward compatibility.

**Google OAuth note:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` remain in `.env` as app-level OAuth credentials. User-specific access/refresh tokens go into the DB under integration names `"gmail"` and `"sheets"` (both saved by a single Google sign-in). `OAUTHLIB_INSECURE_TRANSPORT=1` is set programmatically in the OAuth route for local HTTP development.

### Versioning (`workflow_engine.py`)

- `create_workflow` → saves version 1, `change_summary="Initial creation"`
- `update_workflow` → calls `_compute_diff(old_name, old_json, new_name, new_def)` **before** applying changes, saves new version after
- `_compute_diff` returns `(str summary, list[dict] changed_fields)` covering: name rename, step added/removed, step renamed, step action changed, step params changed, steps reordered
- `list_versions(db, workflow_id)` → newest first

### Execution engine (`execution_engine.py`)

4-layer failure recovery (in order):
1. **`BaseIntegration._recover_fixable()`** — pure-Python fix per adapter (e.g. re-search inbox for valid IDs, fuzzy-match tab names) before any LLM is involved
2. **`BaseIntegration._run_recovery_agent()`** — inline LangGraph `StateGraph` scoped to the adapter; uses tools from `_get_recovery_tools()` (e.g. `list_channels`, `list_sheets`) to find the correct resource and retry
3. **Engine retry** — `MAX_RETRIES = 1` raw re-attempt after both adapter-level recovery layers have failed
4. **`failure_agent.py`** — full LangGraph ReAct agent with 3 tools (`inspect_previous_outputs`, `get_config_defaults`, `try_execute_step`); up to `MAX_FIX_ATTEMPTS` (default 2) rounds; skipped entirely on rate-limit errors

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

### LLM factory (`core/llm.py`)

Shared factory used by both the planner and the agentic runner:
- `chat_complete(messages, system, max_tokens)` — async, dispatches on `settings.ai_provider`
- `get_langchain_llm()` — returns a LangChain-compatible LLM instance for LangGraph agents

Supports `"openrouter"` (primary), `"groq"`, and `"anthropic"`.

### Workflow Planner (`planner/llm_planner.py`)

`plan_workflow(natural_language)` dispatches based on `settings.ai_provider`:
- `"openrouter"` → `_call_openrouter()` using OpenAI-compatible client pointed at `openrouter_base_url`
- `"groq"` → `_call_groq()` using `AsyncGroq`
- `"anthropic"` → `_call_anthropic()` using `AsyncAnthropic`

The system prompt is **built dynamically** via `_build_system_prompt()` which pulls live integration specs from `IntegrationRegistry` (available actions, output shapes, configured resources). Static sections come from `prompts.py` — edit there to tune planner behavior.

`_parse_llm_output` strips markdown fences, parses JSON, validates integrations against `IntegrationRegistry`, and strips `integration.` prefixes from action names if the LLM includes them.

#### `prompts.py` — key prompt constants

| Constant | Purpose |
|---|---|
| `PLANNER_INTRO` | Opening instruction block for the workflow planner |
| `PLANNER_OUTPUT_STEP_GATE` | Rules for when to add Slack/email output steps |
| `PLANNER_RESOURCE_RULES` | Rules for using configured resources (spreadsheet IDs, channels) |
| `PLANNER_GENERIC_INTEGRATION` | Instructions for the generic integration |
| `PLANNER_CHAINING_RULES` | Multi-step chain patterns with correct step numbering |
| `PLANNER_TRIGGER_RULES` | Cron / trigger field instructions |
| `PLANNER_OUTPUT_FORMAT` | Integration/action allowlist and JSON schema |
| `EXECUTION_CHAT_SYSTEM` | System prompt for post-execution chat (injected with workflow + results context) |
| `CHAT_ASSISTANT_SYSTEM` | System prompt for the FlowForge general chat assistant |
| `AGENT_INTRO` | System prompt prefix for the LangGraph ReAct agent |
| `FAILURE_AGENT_SYSTEM` | System prompt for the LangGraph failure-recovery agent (`failure_agent.py`) |

`PLANNER_CHAINING_RULES` encodes explicit multi-step patterns:

| Pattern | Description |
|---|---|
| A | `search_emails` → `read_emails_batch` → `ai.summarize` |
| B | `search_emails` → `read_emails_batch` → `ai.summarize` → `slack.send_message` |
| C | `search_emails` → `read_emails_batch` → `ai.summarize` → `sheets.append_row` |
| D | `search_emails` → `read_emails_batch` → `slack.send_message` + `sheets.append_rows` (no summarize) |
| E | `search_emails` → `read_emails_batch` → `ai.summarize` → `slack.send_message` + `sheets.append_row` (5-step, both destinations reference `${step_3.summary}`) |

### LangGraph ReAct Agent (`workflow/agent/agentic_runner.py`)

Distinct from the workflow planner and the failure-recovery agent. This is a free-form tool-calling agent:
- Receives a natural-language `query` and dynamically decides which tools to call and in what order
- Adapts based on actual intermediate results
- Never calls a tool the user didn't ask for (e.g. will not post to Slack unless explicitly asked)
- Tools are registered in `workflow/agent/tools.py` and grouped by integration prefix
- Uses `get_langchain_llm()` from `core/llm.py`
- Results (run + each tool step) are persisted to `AgentRun` / `AgentStep` tables
- System prompt built dynamically from `AGENT_INTRO` + tool listing from `IntegrationRegistry`

### Chat assistant (`api/chat.py`, `services/ai_service.py`)

General-purpose Aiden chat assistant. Supports multi-turn conversation with session history, optional memory integration, and tool calling. Uses `CHAT_ASSISTANT_SYSTEM` prompt. Session history is scoped by `session_id`.

### Scheduler

APScheduler (background in-process). Cron expression lives in `workflow_json.trigger.condition` (written by the LLM planner). `register_workflow_schedule` parses and registers the job; `load_scheduled_workflows` re-registers on startup.

### API routes

```
# Workflow CRUD + lifecycle
POST   /api/workflows/                    Plan + create workflow (returns draft)
GET    /api/workflows/?status=            List all; optional filter by status
GET    /api/workflows/{id}
PUT    /api/workflows/{id}                Update name/steps → resets status to draft
DELETE /api/workflows/{id}
GET    /api/workflows/{id}/versions       Version history (newest first)
GET    /api/workflows/{id}/executions

# Review / approval
POST   /api/workflows/{id}/approve        Set status=approved; execute=true (default) → starts run
POST   /api/workflows/{id}/reject         Set status=rejected; optional reason stored
POST   /api/workflows/{id}/replan         Re-invoke LLM planner, replace steps, reset to draft

# Step-level CRUD
GET    /api/workflows/{id}/steps
POST   /api/workflows/{id}/steps          Add step; insert_after=<step_id> or append
PATCH  /api/workflows/{id}/steps/{step_id}
DELETE /api/workflows/{id}/steps/{step_id}

# Execution
POST   /api/workflows/{id}/execute        Starts background execution → 202
POST   /api/workflows/{id}/chat           Chat about a workflow (step refinement)

# Schedule
POST   /api/workflows/{id}/schedule/enable
POST   /api/workflows/{id}/schedule/disable
PUT    /api/workflows/{id}/schedule
GET    /api/workflows/{id}/schedule/status

# Executions
GET    /api/executions/{id}
GET    /api/executions/{id}/logs          Per-step logs
POST   /api/executions/{id}/resume        Resume a failed execution from where it stopped
POST   /api/executions/{id}/chat          Chat about execution results with LLM context

# Agentic runner
POST   /api/agent/runs/                   Start agent run → 202; poll for result
GET    /api/agent/runs/                   List recent runs (newest first)
GET    /api/agent/runs/{run_id}           Get run + all tool steps

# Integrations
GET    /api/integrations/status           List [{integration, connected, connected_at}]
GET    /api/integrations/google/connect   Redirect → Google OAuth consent screen
GET    /api/integrations/google/callback  Exchange code → save gmail+sheets tokens → close popup
POST   /api/integrations/slack            Validate + save Slack bot token {bot_token}
DELETE /api/integrations/{integration}    Disconnect (google removes both gmail+sheets)

# Chat assistant
POST   /api/chat/send                     Send message with memory + tool integration
GET    /api/chat/history/{session_id}     Get conversation history
DELETE /api/chat/history/{session_id}     Clear session

# Memory
POST   /api/memory/add
POST   /api/memory/search
GET    /api/memory/list/{session_id}
DELETE /api/memory/item/{session_id}/{item_id}
DELETE /api/memory/clear/{session_id}

# Tools
GET    /api/tools/list
POST   /api/tools/call

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
"create"    → Input form / workflow list sidebar
      ↓  (planWorkflow → creates draft)
"review"    → WorkflowReviewView — inspect, modify, approve or reject
      ↓  (user clicks Approve & Run → POST /approve with execute=true)
"executing" → ExecutionView — live polling every 1.5s
      ↓  (execution completes)
"done"      → DoneView — summary + next actions
```

**Critical:** The "▶ Run" button on existing saved workflows always routes to `"review"` first — never directly to `"executing"`. This ensures every execution is reviewed before it runs. Any edit in review resets status to `draft` on the backend.

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

Key interfaces:

```ts
interface Workflow {
  id: string
  name: string
  original_input: string
  workflow_json: WorkflowJson
  explanation: string
  status: "draft" | "approved" | "rejected"
  schedule_enabled: boolean
  schedule_timezone: string
  next_run: string | null
  updated_at: string
}

interface IntegrationStatus {
  integration: "gmail" | "slack" | "sheets"
  connected: boolean
  connected_at: string | null
}

interface ExecutionChatMessage { role: "user" | "assistant"; content: string }
interface ExecutionChatResponse { reply: string }
```

### API client (`lib/api.ts`)

All fetch calls go through `req<T>()` which handles error extraction and 204 responses.

```ts
// Workflows
planWorkflow(naturalLanguage)           // POST /api/workflows/
listWorkflows()
getWorkflow(id)
updateWorkflow(id, { name?, workflow_json? })  // PUT → resets status to draft
deleteWorkflow(id)
replanWorkflow(id)                      // POST /api/workflows/{id}/replan

// Review
approveWorkflow(id, execute=true)       // POST /approve; execute=true starts run immediately
rejectWorkflow(id, reason?)             // POST /reject

// Step-level CRUD
listSteps(workflowId)
addStep(workflowId, { name, integration, action, params?, description?, insert_after? })
updateStep(workflowId, stepId, patch)
deleteStep(workflowId, stepId)

// Executions
executeWorkflow(id, opts?)              // POST /execute
listExecutions(workflowId)
getExecution(id)
getExecutionLogs(id)
resumeExecution(id)
chatWithExecution(executionId, message, history)  // POST /executions/{id}/chat

// Chat
chatWithWorkflow(workflowId, message)   // POST /workflows/{id}/chat

// Versions
getWorkflowVersions(id)

// Integrations
getIntegrationStatus()
saveSlackToken(bot_token)
disconnectIntegration(name)

// Schedule
enableSchedule(id, scheduleTimezone?)
disableSchedule(id)
updateSchedule(id, scheduleEnabled, scheduleTimezone?)
getScheduleStatus(id)
```

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
# AI provider — "openrouter" (default) | "groq" | "anthropic"
AI_PROVIDER=openrouter

# OpenRouter (primary — OpenAI-compatible, routes to any model)
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Groq (legacy fallback)
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile

# Anthropic (fallback)
ANTHROPIC_API_KEY=...

CORS_ORIGINS=http://localhost:3000

# Google OAuth app credentials (stay in .env; user tokens go to DB)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Optional fallbacks — used if no DB credential exists for the integration
GOOGLE_REFRESH_TOKEN=...
SLACK_BOT_TOKEN=...
SLACK_DEFAULT_CHANNEL=#general
SHEETS_SPREADSHEET_ID=...

# LLM / agent behaviour (optional — defaults shown)
LLM_TEMPERATURE=0.0
MAX_EXECUTION_RETRIES=3
MAX_FIX_ATTEMPTS=2
AI_TOOLS_MAX_TOKENS=1024
TEXT_INPUT_MAX_CHARS=12000
PLANNER_MAX_TOKENS=4096
MAX_AGENT_STEPS=20
MEMORY_MAX_ITEMS=100
```

Frontend (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Google OAuth local setup:** Add `http://localhost:8000/api/integrations/google/callback` to "Authorized redirect URIs" in Google Cloud Console → Credentials → OAuth 2.0 Client ID. The `OAUTHLIB_INSECURE_TRANSPORT=1` env var is set programmatically for local HTTP — do not set it in production.

**AI provider:** `get_settings()` uses `lru_cache`, so a server restart is required after editing `.env`. If OpenRouter key is invalid, switch to `AI_PROVIDER=groq` or `AI_PROVIDER=anthropic` with the corresponding key.

---

## Key conventions

- Backend IDs are UUIDs (strings), generated at model creation with `default=lambda: str(uuid.uuid4())`
- `workflow_json` is stored as JSON in SQLite; TypeScript type is `WorkflowJson`
- All timestamps are UTC; frontend formats via `fmtDate()` from `lib/utils.ts`
- Pydantic v2: use `model_validate` (not `from_orm`), use `model_config = ConfigDict(from_attributes=True)`
- Never call `datetime.utcnow()` in new code — use `datetime.now(UTC)` (utcnow is deprecated in Python 3.12+). Pre-existing usages are grandfathered
- Frontend API calls all go through the `req<T>()` helper in `lib/api.ts` which handles error extraction and 204 responses
- Never store `.env` secrets in memory files or version control. `backend/.env` must be in `.gitignore`.
