# FlowForge — AI Workflow Automation Platform

FlowForge lets you describe a multi-step automation in plain English and turns it into a structured, reviewable, executable workflow. It connects Gmail, Slack, and Google Sheets through an LLM-powered planner, a live execution engine, a LangGraph ReAct agent, and a conversational chat assistant — all from a single Next.js UI.

---

## Table of Contents

1. [Features](#features)
2. [Architecture Overview](#architecture-overview)
3. [Component Deep-Dive](#component-deep-dive)
4. [Key Design Decisions](#key-design-decisions)
5. [Assumptions](#assumptions)
6. [Tradeoffs](#tradeoffs)
7. [Setup Guide](#setup-guide)
8. [Environment Variables](#environment-variables)
9. [API Reference](#api-reference)
10. [Future Improvements](#future-improvements)

---

## Features

| Category | Capability |
|---|---|
| **Workflow planning** | Natural language → structured multi-step workflow via LLM |
| **Review & approval** | Draft → review → approve/reject lifecycle before any execution |
| **Query-driven replan** | Edit the automation description and click Re-plan to regenerate the entire workflow in one click |
| **Execution engine** | Step runner with per-step retry, rate-limit backoff, and failure recovery |
| **Step-output chaining** | `${step_N.field}` references pass outputs between steps at runtime |
| **LangGraph agent** | Free-form ReAct agent for dynamic tool use (separate from the planner) |
| **Failure recovery** | Second LangGraph agent auto-patches steps that fail during execution |
| **Version history** | Full workflow snapshots with structured diff on every save |
| **Scheduled runs** | Cron-based scheduling via APScheduler; toggle per-workflow |
| **Execution chat** | Post-run LLM chat contextualised with step results |
| **Workflow chat** | In-review chat to refine steps conversationally |
| **Chat assistant** | Aiden — a general-purpose multi-turn assistant with memory and tools |
| **Integration management** | Google OAuth popup + Slack token UI; credentials stored in DB |

---

## Architecture Overview

### System diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Browser  (Next.js · :3000)                        │
│                                                                          │
│   ┌─────────────┐   ┌────────────────┐   ┌──────────────────────────┐    │
│   │  Workflow UI│   │  Agent Chat UI │   │   Aiden Chat Assistant   │    │
│   │  (page.tsx) │   │  (app/agent/)  │   │   (api/chat + memory)    │    │
│   └──────┬──────┘   └───────┬────────┘   └────────────┬─────────────┘    │
│          │                  │                         │                  │
│          └──────────────────┴─────────────────────────┘                  │
│                             │  REST / JSON                               │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────────────┐
│                       FastAPI Backend  (:8000)                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                        API Layer (routers)                       │   │
│  │  /api/workflows  /api/executions  /api/agent/runs                │   │
│  │  /api/chat       /api/memory      /api/integrations  /api/tools  │   │
│  └───────┬──────────────┬──────────────────────────────────────────-┘   │
│          │              │                                               │
│  ┌───────▼──────┐  ┌────▼─────────────────────────────────────────┐   │
│  │  LLM Planner │  │              Execution Engine                  │   │
│  │  (OpenRouter │  │  ┌──────────┐  ┌────────────┐  ┌──────────┐  │   │
│  │   / Groq /   │  │  │ Step run │→ │ 3-layer    │→ │ Log write│  │   │
│  │   Anthropic) │  │  │ + retry  │  │ recovery   │  │ to DB    │  │   │
│  └───────┬──────┘  │  └──────────┘  └────────────┘  └──────────┘  │   │
│          │         └──────────────────────────┬────────────────────┘   │
│  ┌───────▼─────────────────────────────────────▼──────────────────┐    │
│  │            LangGraph — 3 instantiation sites                    │    │
│  │  agentic_runner.py — ReAct agent; invoked from /api/agent/runs  │    │
│  │  failure_agent.py  — exec-engine failure path (retries > max)   │    │
│  │  base.py inline    — per-adapter recovery graph on dispatch err  │    │
│  └───────────────────────────┬─────────────────────────────────────┘   │
│                              │                                          │
│  ┌───────────────────────────▼─────────────────────────────────────┐   │
│  │                  Integration Adapters                            │   │
│  │  Gmail ·  Slack ·  Google Sheets ·  AI Tools ·  Generic HTTP    │   │
│  └────────┬──────────────┬────────────────────┬────────────────────┘   │
│           │              │                    │                         │
│  ┌────────▼──┐   ┌───────▼───┐   ┌───────────▼─────┐                 │
│  │ SQLite DB │   │APScheduler│   │  LLM Factory     │                 │
│  │workflow.db│   │  (cron)   │   │  core/llm.py     │                 │
│  └───────────┘   └───────────┘   └────────┬─────────┘                 │
└──────────────────────────────────────────┼──────────────────────────────┘
                                           │
┌──────────────────────────────────────────▼──────────────────────────────┐
│                      External Services                                   │
│   OpenRouter / Groq / Anthropic   ·   Gmail API   ·   Slack API         │
│                                       Google Sheets API                  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Workflow lifecycle

```
User types natural language
        │
        ▼
POST /api/workflows/    ──►  LLM Planner  ──►  WorkflowDefinition JSON
        │                                              │
        ▼                                             DB (status = "draft")
   Review UI  ◄──────────────────────────────────────┘
   (inspect, edit steps, chat to refine)
        │
        ├── Reject  ──►  status = "rejected"  (must edit before re-approving)
        │
        └── Approve ──►  status = "approved"  ──►  Execution Engine
                                                         │
                                              Per-step loop:
                                              1. resolve ${step_N.field} refs
                                              2. call integration adapter
                                              3. on error → retry → backoff
                                                            → failure agent
                                              4. write ExecutionLog to DB
                                                         │
                                              status = "success" | "failed"
                                                         │
                                                     Done view
                                              (post-run LLM chat available)
```

### Data model

```
Workflow ─── has many ──► WorkflowVersion   (snapshot on every save)
         ─── has many ──► Execution
                              └─── has many ──► ExecutionLog  (one per step)

AgentRun ─── has many ──► AgentStep

IntegrationCredential  (one row per integration — gmail, slack, sheets)
```

---

## Component Deep-Dive

### Backend

#### `app/core/config.py` — Settings

All configuration is read from `backend/.env` via Pydantic `BaseSettings`. The `get_settings()` function is decorated with `@lru_cache` so the file is only parsed once per process — a server restart is required after any `.env` change.

#### `app/database.py` — Schema management

Uses SQLAlchemy `Base.metadata.create_all()` for initial table creation and a `_migrate_schema()` helper that runs `ALTER TABLE … ADD COLUMN` statements through `PRAGMA table_info` introspection. This avoids Alembic while still supporting live schema evolution.

On every startup, `_reset_stuck_executions()` finds any `Execution` rows still in `"running"` state (left over from a hard kill) and marks them `"failed"` with an explanatory message.

#### `app/workflow/planner/llm_planner.py` — Workflow Planner

Converts a plain-English description into a `WorkflowDefinition` (name, trigger, and steps list). The system prompt is built **dynamically** each call by querying `IntegrationRegistry` for the current integration specs, available actions, and configured resource IDs — so adding a new integration automatically updates the prompt without touching `prompts.py`.

Dispatches on `AI_PROVIDER`:
- `"openrouter"` (default) — OpenAI-compatible client pointed at `https://openrouter.ai/api/v1`
- `"groq"` — `AsyncGroq` client
- `"anthropic"` — `AsyncAnthropic` client

Output is parsed by `_parse_llm_output`: strips markdown fences, validates JSON, checks integrations against the registry, and normalises action names (strips `gmail.` prefix if the model included it).

#### `app/workflow/engine/execution_engine.py` — Execution Engine

Runs workflow steps sequentially in a FastAPI `BackgroundTask`. Before each step:

1. **`_resolve_params`** walks the step's params dict and replaces `${step_N.field}` references with outputs from prior steps. Two-pass regex handles both whole-value references (which should arrive as Python objects) and inline string interpolation.
2. The step is dispatched to the matching integration adapter via `IntegrationRegistry`.
3. On failure: engine retry (configurable `MAX_RETRIES`) → rate-limit exponential back-off → LangGraph `failure_agent.py` for AI-assisted repair.
4. A `ExecutionLog` row is written for every step regardless of outcome.

Supports mid-workflow resume: `create_execution_from_step` seeds prior step outputs from the most recent successful run so that `${step_N.field}` references still resolve correctly when restarting partway through.

#### `app/workflow/integrations/base.py` — Integration abstraction

`BaseIntegration` defines the contract every adapter must satisfy:

| Method | Required | Purpose |
|---|---|---|
| `_dispatch(action, params)` | Yes | Route action string to the correct handler |
| `_classify_error(exc)` | No | Map exceptions to `ErrorCategory` |
| `_recover_fixable(action, params, exc)` | No | Pure-Python fix before the LLM agent is invoked |
| `_get_recovery_tools()` | No | `@tool`-decorated discovery functions the LangGraph agent may call |
| `get_agent_tools()` | No | LangChain tools exposed to the ReAct agent |

`IntegrationRegistry` is a class-level registry — each integration calls `IntegrationRegistry.register()` on import. The dynamic planner prompt, agent tool list, and configured-resource display all read from this registry.

When `_recover_fixable()` cannot resolve a dispatch error on its own, `_run_recovery_agent()` builds a scoped `StateGraph` inline — one agent node paired with a `ToolNode` containing the tools from `_get_recovery_tools()`. This is the third LangGraph instantiation in the codebase, distinct from the standalone ReAct agent (`agentic_runner.py`) and the execution-level failure agent (`failure_agent.py`).

#### `app/workflow/agent/agentic_runner.py` — LangGraph ReAct Agent

A full LangGraph `StateGraph` with a `ToolNode`. Unlike the planner (which generates a fixed plan), this agent:
- Decides which tools to call at runtime based on intermediate results
- Never proactively calls output tools (Slack, email) unless explicitly asked
- Persists every tool invocation as an `AgentStep` row

The agent is wired to `get_langchain_llm()` from `core/llm.py`, which returns the appropriate LangChain model class based on `AI_PROVIDER`.

#### `app/workflow/agent/failure_agent.py` — Failure Recovery Agent

Invoked by the execution engine when a step exhausts its retries. Given the failed step definition and error message, this narrowly-scoped agent attempts to:
1. Call integration-specific discovery tools (`list_channels`, `list_sheets`, etc.) to find the correct resource name
2. Patch the step params and retry the action

`MAX_FIX_ATTEMPTS` caps the number of LLM-assisted repair rounds.

#### `app/api/chat.py` + `services/ai_service.py` — Aiden Chat Assistant

A general-purpose multi-turn assistant with:
- Session-scoped conversation history
- Optional memory retrieval from `services/memory_service.py`
- Tool calling via `services/tools_service.py` (currently `datetime_info`; extensible)
- Governed by `CHAT_ASSISTANT_SYSTEM` prompt in `prompts.py`

#### `app/prompts.py` — Prompt library

All system prompts live here to make tuning behaviour straightforward without touching business logic:

| Constant | Used by |
|---|---|
| `PLANNER_INTRO` … `PLANNER_OUTPUT_FORMAT` | Workflow planner (assembled by `_build_system_prompt`) |
| `PLANNER_CHAINING_RULES` | Teaches the LLM correct `${step_N.field}` numbering |
| `AGENT_INTRO` | ReAct agent system prompt prefix |
| `FAILURE_AGENT_SYSTEM` | Failure recovery agent (`failure_agent.py`) |
| `EXECUTION_CHAT_SYSTEM` | Post-execution contextual chat |
| `CHAT_ASSISTANT_SYSTEM` | Aiden general chat |

---

### Frontend

#### `app/page.tsx` — Root page & integration gate

On mount, `Home` fetches `GET /api/integrations/status`. If any integration is disconnected the entire app is replaced with `<IntegrationSetup>` — the workflow UI is never rendered until credentials are present (or the user skips).

Once past the gate, `WorkflowApp` manages a `WfView` discriminated union (`"create" | "review" | "executing" | "done"`) that drives which panel renders. Every transition through `"review"` is mandatory — there is no path from the workflow list directly to execution.

#### `components/workflow/review-view.tsx` — Review panel

The central editing surface. Shows the LLM explanation, all steps (via `StepCard`), and action buttons (Approve & Run, Reject). Hosts the `WorkflowChat` component for conversational step refinement. Modifications call step-level CRUD endpoints; any PUT resets `status` to `"draft"` on the backend.

#### `components/workflow/execution-view.tsx` — Live execution

Polls `GET /api/executions/{id}` and `GET /api/executions/{id}/logs` in parallel every 1 500 ms. Surfaces live per-step status, in-flight errors as a banner, and a full failure panel with resume option when the execution ends in `"failed"`.

#### `components/workflow/version-history-panel.tsx` — Version history

Fetches all versions newest-first and renders each as a collapsible row with a structured diff view (NAME / ADDED / REMOVED / RENAMED / ACTION / PARAMS / REORDERED change-type pills) plus a toggleable before/after JSON diff for parameter changes.

#### `lib/utils.ts` — Design tokens

All colour, spacing, and typography values are exported as the `C` object. Every component imports and uses `C.*` for inline styles — no CSS framework, no Tailwind classes, no CSS modules.

---

## Key Design Decisions

### 1. LLM planner generates, humans approve

The LLM never triggers execution directly. Every workflow goes through a `draft → review → approved` gate. This prevents LLMs from running destructive or incorrect automations silently and keeps humans in the loop for consequential actions (sending emails, writing to spreadsheets).

### 2. Dynamic prompt construction

The planner system prompt is rebuilt on each call from live `IntegrationRegistry` data rather than being a static string. This means:
- Adding a new integration automatically exposes it to the planner
- Configured resource IDs (spreadsheet, Slack channel) are injected at call time so the LLM uses the actual values, not placeholders
- Chaining examples and action catalogs are always in sync with the real code

### 3. Integration registry pattern

All integration adapters self-register on import. The registry is the single source of truth for which integrations exist, what actions they support, what outputs they produce, and which LangChain tools they expose to the agent. No central routing table needs updating when an integration is added.

### 4. Two-pass `${step_N.field}` resolution

Step-output references are resolved in two passes:
- Pass 1 handles whole-value references and strips surrounding quotes so lists and objects arrive as Python types, not JSON strings
- Pass 2 handles references embedded inside larger strings

A strict validator after both passes only flags `${step_N.*}` patterns — never bare `${variable}` strings in email bodies.

### 5. Credentials in the database, not `.env`

User integration tokens (Google OAuth, Slack bot token) are stored in the `IntegrationCredential` table. This means:
- Credentials survive server restarts without re-entering them
- Connect/disconnect is instant — the Slack adapter does a fresh DB lookup on every call
- `.env` fallbacks remain for backward compatibility but are optional once the setup UI has been used

### 6. No Alembic — `ALTER TABLE` migrations

Schema evolution is handled by a `_migrate_schema()` function that uses `PRAGMA table_info` to detect missing columns and applies `ALTER TABLE … ADD COLUMN` statements at startup. This keeps the dev experience simple (no migration files to generate or run) while still supporting safe schema changes on existing databases.

### 7. Multi-provider LLM via a single factory

`core/llm.py` abstracts over OpenRouter, Groq, and Anthropic. Any component that needs an LLM calls `chat_complete()` or `get_langchain_llm()` — never imports a provider SDK directly. Switching providers requires only a config change, not code changes.

---

## Assumptions

1. **Single-user deployment** — credentials, sessions, and the SQLite database are not partitioned by user. The app is designed for personal or small-team use on a single machine.
2. **SQLite is sufficient** — workflow data volumes are small; no concurrent write contention is expected. Switching to PostgreSQL requires only changing `DATABASE_URL`.
3. **LLM output is trustworthy enough to execute after review** — the system assumes that a human reviewing the generated workflow steps is sufficient validation before execution; it does not sandbox or simulate step execution before running.
4. **Integrations operate on behalf of a single Google/Slack account** — there is one set of stored credentials per integration, not per-user.
5. **Steps are sequential** — the execution engine runs steps one after another. Parallel step execution is not supported.
6. **OpenRouter/Groq/Anthropic network availability** — the planner and agents have no offline fallback (no `USE_MOCK_AI` flag exists in the current config).

---

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| SQLite over PostgreSQL | Zero-setup, embedded, no extra service | Cannot scale to concurrent multi-user write load |
| No Alembic | No migration file overhead for a single-developer project | `ALTER TABLE` migrations don't support column renames or drops |
| Sequential step execution | Simple mental model, easy chaining, straightforward retry | Long workflows are slow; one slow step blocks everything after it |
| Dynamic system prompt rebuilt each call | Always in sync with real integration state | Adds latency + token cost on every `/api/workflows/` POST |
| Credentials in DB (not `.env`) | UI-driven connect/disconnect; no server restart needed | If DB is lost, all credentials must be re-entered |
| Inline styles only (no CSS framework) | No build-step dependency, design tokens in one file | Verbose JSX, no utility-class composability |
| Approval gate before every execution | Prevents accidental LLM-triggered actions | Adds a mandatory click for users who trust the planner |
| LangGraph ReAct agent separate from execution | Agent can call tools in arbitrary order; flexible | Two LLM calls per agentic run (plan + each tool); costs more |
| `lru_cache` on settings | Single `.env` parse per process | Config changes require a server restart |

---

## Setup Guide

### Prerequisites

- Python 3.11+
- Node.js 18+
- A Google Cloud project with OAuth 2.0 credentials (for Gmail + Sheets)
- A Slack workspace with a bot token (for Slack)
- An API key for at least one LLM provider: [OpenRouter](https://openrouter.ai), [Groq](https://console.groq.com), or [Anthropic](https://console.anthropic.com)

---

### 1. Clone the repository

```bash
git clone <repo-url>
cd Giridhar_Aiden_AI
```

---

### 2. Backend setup

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Create `backend/.env`:

```env
# AI provider (pick one)
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct

# CORS
CORS_ORIGINS=http://localhost:3000

# Google OAuth — create at console.cloud.google.com → APIs & Services → Credentials
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Start the backend:

```bash
python -m uvicorn app.main:app --reload --port 8000
```

The SQLite database (`workflow.db`) is created automatically on first run.

---

### 3. Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add `http://localhost:8000/api/integrations/google/callback` to **Authorized redirect URIs**
4. Enable the **Gmail API** and **Google Sheets API** in **APIs & Services** → **Enabled APIs**
5. Copy the client ID and secret into `backend/.env`

---

### 4. Slack bot setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch
2. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `channels:read`, `channels:history`
   - `chat:write`, `chat:write.public`
3. Click **Install to Workspace** and copy the `xoxb-...` bot token
4. Invite the bot to any channels it should post to: `/invite @your-bot-name`
5. The token is entered in the app's integration setup screen (not in `.env`)

---

### 5. Frontend setup

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start the frontend:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

### 6. First run

1. The app shows the **Integration Setup** screen
2. Click **Sign in with Google** — a popup opens, complete the OAuth flow; Gmail and Sheets connect together
3. Enter your Slack `xoxb-...` bot token and click **Save Token**
4. Click **Continue to Workflows →**
5. Type a workflow description in the input box and press Enter
6. Review the generated steps, modify if needed, then click **Approve & Run**

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | `openrouter` | LLM provider: `openrouter` \| `groq` \| `anthropic` |
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `OPENROUTER_MODEL` | `meta-llama/llama-3.3-70b-instruct` | Model to request via OpenRouter |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter API base URL |
| `GROQ_API_KEY` | — | Groq API key (if `AI_PROVIDER=groq`) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (if `AI_PROVIDER=anthropic`) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `DATABASE_URL` | `sqlite:///./workflow.db` | SQLAlchemy database URL |
| `GOOGLE_CLIENT_ID` | — | Google OAuth app client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth app client secret |
| `GOOGLE_REFRESH_TOKEN` | — | Optional `.env` fallback refresh token |
| `SLACK_BOT_TOKEN` | — | Optional `.env` fallback Slack bot token |
| `SLACK_DEFAULT_CHANNEL` | `#general` | Default Slack channel |
| `SHEETS_SPREADSHEET_ID` | — | Optional `.env` fallback spreadsheet ID |
| `LLM_TEMPERATURE` | `0.0` | Temperature for all LLM calls |
| `MAX_EXECUTION_RETRIES` | `3` | Backoff attempts for rate-limit errors |
| `MAX_FIX_ATTEMPTS` | `2` | Max LLM-assisted repair rounds in failure agent |
| `AI_TOOLS_MAX_TOKENS` | `1024` | Max output tokens for summarize/extract/transform |
| `TEXT_INPUT_MAX_CHARS` | `12000` | Max characters of email body sent to an LLM |
| `PLANNER_MAX_TOKENS` | `4096` | Max output tokens for the workflow planner |
| `MAX_AGENT_STEPS` | `20` | Max tool-call rounds in the ReAct agent |
| `MEMORY_MAX_ITEMS` | `100` | Max memory items per chat session |
| `SCHEDULER_TIMEZONE` | `UTC` | Default timezone for scheduled workflows |

### Frontend (`frontend/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend base URL |

---

## API Reference

### Workflows

```
POST   /api/workflows/                     Plan + create workflow from natural language
GET    /api/workflows/?status=             List all workflows (optional status filter)
GET    /api/workflows/{id}                 Get workflow by ID
PUT    /api/workflows/{id}                 Update workflow (resets status to draft)
DELETE /api/workflows/{id}                 Delete workflow and all executions

POST   /api/workflows/{id}/approve         Approve; execute=true (default) starts immediately
POST   /api/workflows/{id}/reject          Reject with optional reason
POST   /api/workflows/{id}/replan          Re-invoke LLM planner, replace steps

GET    /api/workflows/{id}/steps           List steps
POST   /api/workflows/{id}/steps           Add step (insert_after=<step_id> or append)
PATCH  /api/workflows/{id}/steps/{step_id} Update step
DELETE /api/workflows/{id}/steps/{step_id} Delete step

POST   /api/workflows/{id}/execute         Start execution → 202
POST   /api/workflows/{id}/chat            Chat to refine a workflow
GET    /api/workflows/{id}/versions        Version history (newest first)
GET    /api/workflows/{id}/executions      Execution history

POST   /api/workflows/{id}/schedule/enable
POST   /api/workflows/{id}/schedule/disable
PUT    /api/workflows/{id}/schedule
GET    /api/workflows/{id}/schedule/status
```

### Executions

```
GET    /api/executions/{id}                Get execution status + current step
GET    /api/executions/{id}/logs           Get per-step logs
POST   /api/executions/{id}/resume         Resume a failed execution
POST   /api/executions/{id}/chat           Chat about execution results with LLM context
```

### Agent

```
POST   /api/agent/runs/                    Start a ReAct agent run → 202
GET    /api/agent/runs/                    List recent runs
GET    /api/agent/runs/{run_id}            Get run + all tool steps
```

### Integrations

```
GET    /api/integrations/status            [{integration, connected, connected_at}]
GET    /api/integrations/google/connect    Start Google OAuth flow
GET    /api/integrations/google/callback   OAuth callback — saves gmail + sheets tokens
POST   /api/integrations/slack             Save Slack bot token {bot_token}
DELETE /api/integrations/{integration}     Disconnect integration
```

### Chat & Memory

```
POST   /api/chat/send                      Send message to Aiden
GET    /api/chat/history/{session_id}      Get conversation history
DELETE /api/chat/history/{session_id}      Clear session

POST   /api/memory/add                     Store a memory item
POST   /api/memory/search                  Semantic search over memories
GET    /api/memory/list/{session_id}        List all memory for a session
DELETE /api/memory/item/{session_id}/{id}  Delete one memory item
DELETE /api/memory/clear/{session_id}      Clear all memory for a session

GET    /api/tools/list                     List available tools
POST   /api/tools/call                     Call a tool by name

GET    /health
```

---

## Future Improvements

### Short-term

- **Parallel step execution** — steps with no data dependency between them could run concurrently to reduce end-to-end latency
- **More integration adapters** — HubSpot, Notion, Airtable, GitHub, Jira all follow the `BaseIntegration` pattern and would need minimal new code
- **Streaming execution logs** — replace the 1 500 ms poll with SSE or WebSockets for truly live step output
- **Workflow templates** — let users save and re-use workflow skeletons; pre-populate the planner with a starting point

### Medium-term

- **Multi-user support** — add authentication (OAuth or email/password), partition workflows, credentials, and chat sessions by user ID
- **PostgreSQL** — swap `DATABASE_URL` to a PostgreSQL connection string; remove SQLite-specific `check_same_thread` flag; use Alembic for proper migrations
- **Step simulation / dry-run** — run a workflow against sandboxed API responses before live execution; useful for testing destructive workflows
- **Conditional branches** — extend `WorkflowJson` to support `if/else` routing and loops, not just linear step sequences
- **Human-in-the-loop steps** — a `generic` step that pauses execution and waits for manual approval via the UI before continuing
- **Tool memory for the agent** — persist successful tool-call patterns and surface them as few-shot examples in the agent prompt

### Long-term

- **Multi-agent orchestration** — compose sub-agents (e.g. a research agent, a writing agent, a data-extraction agent) into a coordinator workflow
- **Observability** — integrate OpenTelemetry tracing across LLM calls, integration calls, and execution steps; export to Grafana / Jaeger
- **Plugin marketplace** — let third-party integrations self-register via a manifest file, enabling community-contributed adapters without forking the codebase
- **Mobile / PWA** — the current UI is desktop-first; a responsive layout and service worker would enable mobile workflow monitoring
