"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { Workflow, Execution, ExecutionLog, IntegrationStatus } from "@/lib/types"
import { Spinner } from "@/components/ui/spinner"
import { Btn } from "@/components/ui/button"
import { ReviewView } from "@/components/workflow/review-view"
import { ExecutionView } from "@/components/workflow/execution-view"
import { DoneView } from "@/components/workflow/done-view"
import { HistoryPanel } from "@/components/workflow/history-panel"
import { VersionHistoryPanel } from "@/components/workflow/version-history-panel"
import * as api from "@/lib/api"

// ─── Types ────────────────────────────────────────────────────────────────────

type WfView =
  | { type: "create" }
  | { type: "review";    workflow: Workflow }
  | { type: "executing"; executionId: string; workflow: Workflow }
  | { type: "done";      execution: Execution; logs: ExecutionLog[]; workflow: Workflow }

// ─── Constants ────────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "Search for unread emails summarize with AI, and post to #support on Slack",
  "Get the 5 most recent emails from my inbox and summarize each one",
  "Summarize the latest email from aidenai and send it to me on Slack and Google Sheets",
]

const CONNECTOR_META = [
  { key: "gmail",  label: "Gmail",  color: "#ea4335" },
  { key: "slack",  label: "Slack",  color: "#7b4eb8" },
  { key: "sheets", label: "Sheets", color: "#0f9d58" },
]

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  workflows: Workflow[]
  selected: Workflow | null
  sideLoading: boolean
  onSelectWorkflow: (wf: Workflow) => void
  onNewWorkflow: () => void
  onDelete: (wf: Workflow) => Promise<void>
}

function Sidebar({
  workflows, selected, sideLoading, onSelectWorkflow, onNewWorkflow, onDelete,
}: SidebarProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId]     = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function armConfirm(e: React.MouseEvent, wf: Workflow) {
    e.stopPropagation()
    if (timerRef.current) clearTimeout(timerRef.current)
    if (confirmingId === wf.id) {
      setConfirmingId(null)
      setDeletingId(wf.id)
      onDelete(wf).finally(() => setDeletingId(null))
    } else {
      setConfirmingId(wf.id)
      timerRef.current = setTimeout(() => setConfirmingId(null), 3000)
    }
  }

  return (
    <aside className="w-60 shrink-0 sidebar-glass flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ background: "#6366f1" }}
          >
            F
          </div>
          <div>
            <div className="text-[14px] font-semibold text-primary leading-none">FlowForge</div>
            <div className="text-[11px] text-subtle mt-0.5 leading-none">AI Automation</div>
          </div>
        </div>
      </div>

      {/* New Workflow */}
      <div className="px-3 pt-3 pb-3 border-b border-white/[0.06]">
        <button
          onClick={onNewWorkflow}
          className="btn-gradient w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-white text-[13px] font-medium border-0 cursor-pointer"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Workflow
        </button>
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto p-2.5 min-h-0">
        <div className="text-[10px] font-semibold tracking-[0.12em] text-subtle px-2 pt-1 pb-2 uppercase">
          Workflows
        </div>
        {sideLoading ? (
          <div className="flex items-center gap-2 text-muted text-xs px-2 py-3">
            <Spinner size={11} /> Loading…
          </div>
        ) : workflows.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-subtle leading-relaxed">
            No workflows yet.
            <br />
            <span className="text-subtle/60">Create one above.</span>
          </div>
        ) : (
          workflows.map(wf => {
            const isConfirming = confirmingId === wf.id
            const isDeleting   = deletingId   === wf.id
            return (
              <div key={wf.id} className="group relative">
                <button
                  onClick={() => !isDeleting && onSelectWorkflow(wf)}
                  className={`nav-item w-full pr-7 ${selected?.id === wf.id ? "active" : ""} ${isConfirming ? "!text-red-400" : ""}`}
                >
                  <span className="flex-1 truncate text-left text-[12.5px]">
                    {isDeleting ? "Deleting…" : wf.name}
                  </span>
                  {wf.schedule_enabled && !isConfirming && (
                    <span className="text-[9px] text-green-400 shrink-0">●</span>
                  )}
                </button>
                <button
                  onClick={e => armConfirm(e, wf)}
                  title={isConfirming ? "Click again to confirm" : "Delete"}
                  className={[
                    "absolute right-1.5 top-1/2 -translate-y-1/2",
                    "w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold",
                    "border-0 cursor-pointer transition-all duration-150",
                    isConfirming
                      ? "bg-red-500/15 text-red-400 opacity-100"
                      : "bg-transparent text-muted opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400",
                  ].join(" ")}
                >
                  {isConfirming ? "?" : "×"}
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

// ─── Bottom input bar ─────────────────────────────────────────────────────────

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

interface BottomInputBarProps {
  query: string
  planning: boolean
  planError: string
  integrationStatuses: IntegrationStatus[]
  onQueryChange: (q: string) => void
  onPlan: () => void
  onExampleClick: (prompt: string) => void
  onRefreshStatuses: () => void
}

function BottomInputBar({
  query, planning, planError, integrationStatuses, onQueryChange, onPlan, onExampleClick, onRefreshStatuses,
}: BottomInputBarProps) {
  const [showConnectors, setShowConnectors] = useState(false)
  const [slackToken, setSlackToken]         = useState("")
  const [slackError, setSlackError]         = useState("")
  const [savingSlack, setSavingSlack]       = useState(false)
  const [envAccepted, setEnvAccepted]       = useState(() => {
    try { return localStorage.getItem("ff_env_accepted") === "1" } catch { return false }
  })
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close popup on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowConnectors(false)
      }
    }
    if (showConnectors) document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [showConnectors])

  // Refresh after Google OAuth popup posts back
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "integration_connected" && e.data?.integration === "google") {
        onRefreshStatuses()
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [onRefreshStatuses])

  function connectGoogle() {
    const popup = window.open(
      `${BASE}/api/integrations/google/connect`,
      "google-oauth",
      "width=520,height=640,left=400,top=120,resizable=yes,scrollbars=yes",
    )
    if (!popup) return
    const timer = setInterval(() => {
      if (popup.closed) { clearInterval(timer); onRefreshStatuses() }
    }, 800)
  }

  async function saveSlack() {
    if (!slackToken.trim()) return
    setSavingSlack(true); setSlackError("")
    try {
      await api.saveSlackToken(slackToken.trim())
      setSlackToken("")
      onRefreshStatuses()
    } catch (e) {
      setSlackError(String(e).replace(/^Error:\s*/, ""))
    } finally {
      setSavingSlack(false)
    }
  }

  const gmailConnected  = integrationStatuses.find(s => s.integration === "gmail")?.connected  ?? false
  const sheetsConnected = integrationStatuses.find(s => s.integration === "sheets")?.connected ?? false
  const slackConnected  = integrationStatuses.find(s => s.integration === "slack")?.connected  ?? false
  const googleConnected = gmailConnected && sheetsConnected
  const anyDisconnected = !googleConnected || !slackConnected
  // Only show badge once statuses have loaded, there are disconnected services, and user hasn't accepted env fallback
  const showWarningBadge = integrationStatuses.length > 0 && anyDisconnected && !envAccepted

  return (
    <div
      className="shrink-0 px-8 py-4"
      style={{ borderTop: "1px solid rgba(255,255,255,0.07)", background: "#0d0d12" }}
    >
      <div className="max-w-[760px] mx-auto">
        {planError && (
          <div
            className="rounded-lg px-4 py-3 text-danger text-[13px] leading-relaxed mb-3"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}
          >
            {planError}
          </div>
        )}

        <div className="relative" ref={wrapperRef}>
          {/* ── Connector popup ── */}
          {showConnectors && (
            <div
              className="absolute bottom-full left-0 mb-2 rounded-xl z-50"
              style={{
                background: "#18181b",
                border: "1px solid rgba(255,255,255,0.10)",
                width: 300,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              <div className="px-4 py-2.5 border-b border-white/[0.06]">
                <span className="text-[10.5px] font-semibold uppercase tracking-widest text-subtle">
                  Connectors
                </span>
              </div>

              <div className="p-2 flex flex-col gap-1">

                {/* Google (Gmail + Sheets) */}
                <div
                  className="rounded-lg px-3 py-2.5"
                  style={{
                    background: googleConnected
                      ? "rgba(34,197,94,0.04)"
                      : envAccepted ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.02)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{
                      background: googleConnected ? "#22c55e" : envAccepted ? "#818cf8" : "#3f3f46",
                    }} />
                    <span className="text-[13px] font-medium" style={{ color: googleConnected || envAccepted ? "#e4e4e7" : "#a1a1aa" }}>
                      Gmail &amp; Sheets
                    </span>
                    <span className="ml-auto text-[11px] font-medium" style={{
                      color: googleConnected ? "#22c55e" : envAccepted ? "#818cf8" : "#52525b",
                    }}>
                      {googleConnected ? "Connected" : envAccepted ? "Env used" : "Not connected"}
                    </span>
                  </div>
                  {!googleConnected && !envAccepted && (
                    <button
                      onClick={connectGoogle}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-zinc-800 border-0 cursor-pointer transition-all duration-150 hover:shadow-md"
                      style={{ background: "#ffffff" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Sign in with Google
                    </button>
                  )}
                  {!googleConnected && envAccepted && (
                    <p className="text-[11px]" style={{ color: "#6366f1" }}>
                      Using backend .env credentials
                    </p>
                  )}
                </div>

                {/* Slack */}
                <div
                  className="rounded-lg px-3 py-2.5"
                  style={{
                    background: slackConnected
                      ? "rgba(34,197,94,0.04)"
                      : envAccepted ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.02)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{
                      background: slackConnected ? "#22c55e" : envAccepted ? "#818cf8" : "#3f3f46",
                    }} />
                    <span className="text-[13px] font-medium" style={{ color: slackConnected || envAccepted ? "#e4e4e7" : "#a1a1aa" }}>
                      Slack
                    </span>
                    <span className="ml-auto text-[11px] font-medium" style={{
                      color: slackConnected ? "#22c55e" : envAccepted ? "#818cf8" : "#52525b",
                    }}>
                      {slackConnected ? "Connected" : envAccepted ? "Env used" : "Not connected"}
                    </span>
                  </div>
                  {!slackConnected && !envAccepted && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-1.5">
                        <input
                          value={slackToken}
                          onChange={e => { setSlackToken(e.target.value); setSlackError("") }}
                          onKeyDown={e => e.key === "Enter" && saveSlack()}
                          placeholder="xoxb-your-bot-token"
                          className="flex-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-mono text-primary outline-none min-w-0"
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
                        />
                        <button
                          onClick={saveSlack}
                          disabled={savingSlack || !slackToken.trim()}
                          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white border-0 transition-all duration-150"
                          style={{
                            background: "#7b4eb8",
                            cursor: savingSlack || !slackToken.trim() ? "not-allowed" : "pointer",
                            opacity: savingSlack || !slackToken.trim() ? 0.45 : 1,
                          }}
                        >
                          {savingSlack ? <Spinner size={10} /> : "Save"}
                        </button>
                      </div>
                      {slackError && (
                        <p className="text-[11px] text-danger">{slackError}</p>
                      )}
                    </div>
                  )}
                  {!slackConnected && envAccepted && (
                    <p className="text-[11px]" style={{ color: "#6366f1" }}>
                      Using backend .env credentials
                    </p>
                  )}
                </div>
              </div>

              {/* Skip footer */}
              {anyDisconnected && (
                <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center justify-between">
                  <span className="text-[11px] text-subtle">
                    Backend env vars used as fallback
                  </span>
                  <button
                    onClick={() => {
                      setEnvAccepted(true)
                      try { localStorage.setItem("ff_env_accepted", "1") } catch { /* ignore */ }
                      setShowConnectors(false)
                    }}
                    className="text-[11.5px] font-medium hover:text-primary transition-colors border-0 bg-transparent cursor-pointer underline underline-offset-2"
                    style={{ color: "#818cf8" }}
                  >
                    Yes, continue
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Input card ── */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "#111113", border: "1px solid rgba(255,255,255,0.09)" }}
          >
            <div className="flex items-start gap-2 px-3 pt-3 pb-2">
              {/* + connector button — amber dot when any disconnected */}
              <button
                onClick={() => setShowConnectors(x => !x)}
                title="Manage connectors"
                className="shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150 border-0 cursor-pointer relative"
                style={{
                  background: showConnectors ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.06)",
                  color: showConnectors ? "#818cf8" : "#71717a",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                {/* Warning dot when any connector is disconnected and user hasn't accepted env fallback */}
                {showWarningBadge && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#0d0d12]"
                    style={{ background: "#f59e0b" }}
                  />
                )}
              </button>

              {/* Textarea */}
              <textarea
                value={query}
                onChange={e => onQueryChange(e.target.value)}
                placeholder="e.g. Search for unread emails from boss@company.com, summarize them with AI, and post to #general on Slack"
                rows={2}
                className="flex-1 bg-transparent border-0 text-primary text-[14px] resize-none leading-relaxed placeholder:text-zinc-600 outline-none"
                style={{ minHeight: 44 }}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onPlan() }}
              />
            </div>

            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <span className="text-[12px] text-zinc-600 select-none">⌘ ↵ to generate</span>
              <button
                onClick={onPlan}
                disabled={planning || !query.trim()}
                className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-[13px] font-medium border-0 transition-all duration-150 ${
                  planning || !query.trim()
                    ? "bg-white/[0.04] text-zinc-600 cursor-not-allowed"
                    : "btn-gradient text-white cursor-pointer"
                }`}
              >
                {planning
                  ? <><Spinner size={12} /> Planning…</>
                  : "Generate plan →"
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main content ─────────────────────────────────────────────────────────────

interface WorkflowsContentProps {
  selected: Workflow | null
  wfView: WfView
  showHistory: boolean
  showVersions: boolean
  reviewKey: number
  onToggleHistory: () => void
  onToggleVersions: () => void
  onEditSteps: () => void
  onRun: () => void
  onHistorySelect: (ex: Execution) => void
  onApprove: (wf: Workflow) => Promise<void>
  onBack: () => void
  onRunAgain: (wf: Workflow) => void
  onResume: (id: string, wf: Workflow) => void
  onWorkflowUpdated: (wf: Workflow) => void
  onExecutionDone: (ex: Execution, logs: ExecutionLog[], wf: Workflow) => void
  onChatReview: (wf: Workflow) => void
  onExampleClick: (prompt: string) => void
}

function WorkflowsContent({
  selected, wfView, showHistory, showVersions, reviewKey,
  onToggleHistory, onToggleVersions, onEditSteps, onRun, onHistorySelect,
  onApprove, onBack, onRunAgain, onResume, onWorkflowUpdated, onExecutionDone,
  onChatReview, onExampleClick,
}: WorkflowsContentProps) {

  return (
    <div className="max-w-[760px] mx-auto px-8 py-8 pb-6 relative">

      {/* ── Review ── */}
      {wfView.type === "review" && (
        <>
          <PageHeader
            title="Review Plan"
            subtitle={wfView.workflow.name}
            onBack={onBack}
          />
          <ReviewView
            key={`${(wfView as Extract<WfView, { type: "review" }>).workflow.id}-${reviewKey}`}
            workflow={wfView.workflow}
            onApprove={onApprove}
            onBack={onBack}
            onWorkflowUpdated={onWorkflowUpdated}
            onReplanned={onChatReview}
          />
        </>
      )}

      {/* ── Executing ── */}
      {wfView.type === "executing" && (
        <>
          <PageHeader
            title={wfView.workflow.name}
            subtitle="Live execution · refreshing every 1.5s"
          />
          <ExecutionView
            executionId={wfView.executionId}
            workflow={wfView.workflow}
            onDone={(ex, logs) => {
              const wf = (wfView as Extract<WfView, { type: "executing" }>).workflow
              onExecutionDone(ex, logs, wf)
            }}
          />
        </>
      )}

      {/* ── Done ── */}
      {wfView.type === "done" && (
        <DoneView
          execution={wfView.execution}
          logs={wfView.logs}
          workflow={wfView.workflow}
          onRunAgain={() => onRunAgain(wfView.workflow)}
          onResume={() => onResume(wfView.execution.id, wfView.workflow)}
          onBack={onBack}
        />
      )}

      {/* ── Create ── */}
      {wfView.type === "create" && (
        <div>
          {/* Selected workflow action bar */}
          {selected && (
            <div className="flex items-start justify-between gap-4 pb-6 mb-6 border-b border-white/[0.07]">
              <div className="min-w-0">
                <h1 className="text-[18px] font-semibold text-primary leading-snug">{selected.name}</h1>
                <p className="text-[12.5px] text-muted mt-1 leading-relaxed truncate max-w-md">{selected.original_input}</p>
              </div>
              <div className="flex gap-2 items-center shrink-0 flex-wrap justify-end">
                <Btn small variant="ghost" onClick={onToggleHistory}>
                  {showHistory ? "← Back" : "History"}
                </Btn>
                <Btn small variant="ghost" onClick={onToggleVersions}>
                  {showVersions ? "← Back" : "Versions"}
                </Btn>
                <Btn small variant="ghost" onClick={onEditSteps}>Edit</Btn>
                <Btn small onClick={onRun}>Run →</Btn>
              </div>
            </div>
          )}

          {/* History panel */}
          {selected && showHistory && (
            <div>
              <SectionHeading>Execution History</SectionHeading>
              <div className="glass-card-static p-5 mt-3">
                <HistoryPanel workflowId={selected.id} onSelect={onHistorySelect} />
              </div>
            </div>
          )}

          {/* Version history panel */}
          {selected && showVersions && (
            <div>
              <SectionHeading>Version History</SectionHeading>
              <p className="text-[12.5px] text-muted mt-1 mb-4 leading-relaxed">
                Every save creates a snapshot with a diff of what changed.
              </p>
              <div className="glass-card-static p-5">
                <VersionHistoryPanel workflowId={selected.id} />
              </div>
            </div>
          )}

          {/* Empty state: heading + examples */}
          {!selected && !showHistory && !showVersions && (
            <div className="flex flex-col items-center justify-center min-h-[55vh] text-center">
              <h1 className="text-[30px] font-bold text-primary leading-tight tracking-tight">
                What should I automate?
              </h1>
              <p className="text-[14px] text-muted mt-2 mb-10 leading-relaxed max-w-lg">
                Describe your task in plain English — FlowForge will build a step-by-step plan
                using your connected services.
              </p>

              {/* Try these */}
              <div className="w-full max-w-[580px]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle mb-3 text-left">
                  Try these
                </div>
                <div className="flex flex-col gap-0.5">
                  {EXAMPLE_PROMPTS.map(ex => (
                    <button
                      key={ex}
                      onClick={() => onExampleClick(ex)}
                      className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg text-[13px] text-muted leading-relaxed transition-colors duration-150 hover:bg-white/[0.04] hover:text-zinc-200 cursor-pointer bg-transparent border-0"
                    >
                      <span className="text-subtle mt-0.5 shrink-0 text-[12px]">→</span>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Small shared components ──────────────────────────────────────────────────

function PageHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return (
    <div className="mb-7">
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-primary transition-colors duration-150 border-0 bg-transparent cursor-pointer mb-3"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
      )}
      <h1 className="text-[20px] font-semibold text-primary leading-tight">{title}</h1>
      {subtitle && <p className="text-[13px] text-muted mt-1">{subtitle}</p>}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[15px] font-semibold text-primary">{children}</h2>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return <WorkflowApp />
}

function WorkflowApp() {
  const [workflows, setWorkflows]               = useState<Workflow[]>([])
  const [selected, setSelected]                 = useState<Workflow | null>(null)
  const [wfView, setWfView]                     = useState<WfView>({ type: "create" })
  const [query, setQuery]                       = useState("")
  const [planning, setPlanning]                 = useState(false)
  const [planError, setPlanError]               = useState("")
  const [showHistory, setShowHistory]           = useState(false)
  const [showVersions, setShowVersions]         = useState(false)
  const [sideLoading, setSideLoading]           = useState(true)
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([])
  const [reviewKey, setReviewKey]               = useState(0)

  const loadWorkflows = useCallback(async () => {
    try { setWorkflows(await api.listWorkflows()) } catch { /* ignore */ }
    setSideLoading(false)
  }, [])

  useEffect(() => { loadWorkflows() }, [loadWorkflows])

  useEffect(() => {
    api.getIntegrationStatus()
      .then(setIntegrationStatuses)
      .catch(() => {})
  }, [])

  async function handlePlan() {
    if (!query.trim()) return
    setPlanning(true); setPlanError("")
    try {
      const wf = await api.planWorkflow(query.trim())
      setWorkflows(prev => {
        const exists = prev.find(w => w.id === wf.id)
        return exists ? prev.map(w => w.id === wf.id ? wf : w) : [wf, ...prev]
      })
      setSelected(wf)
      setWfView({ type: "review", workflow: wf })
    } catch (e) { setPlanError(String(e)) }
    finally { setPlanning(false) }
  }

  function syncWorkflow(updated: Workflow) {
    setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w))
    setSelected(updated)
    setWfView(prev =>
      prev.type === "review" && prev.workflow.id === updated.id
        ? { type: "review", workflow: updated }
        : prev
    )
  }

  function syncWorkflowAndRemount(updated: Workflow) {
    syncWorkflow(updated)
    setReviewKey(k => k + 1)
  }

  async function handleApprove(wf: Workflow): Promise<void> {
    const result = await api.approveWorkflow(wf.id, true) as Execution
    const approvedWf: Workflow = { ...wf, status: "approved" }
    setWorkflows(prev => prev.map(w => w.id === approvedWf.id ? approvedWf : w))
    setSelected(approvedWf)
    setWfView({ type: "executing", executionId: result.id, workflow: approvedWf })
  }

  async function handleRunAgain(wf: Workflow) {
    try {
      const ex = await api.executeWorkflow(wf.id)
      setWfView({ type: "executing", executionId: ex.id, workflow: wf })
    } catch (e) { alert(String(e)) }
  }

  async function handleResume(executionId: string, wf: Workflow) {
    try {
      const ex = await api.resumeExecution(executionId)
      setWfView({ type: "executing", executionId: ex.id, workflow: wf })
    } catch (e) { alert(String(e)) }
  }

  function selectWorkflow(wf: Workflow) {
    setSelected(wf); setShowHistory(false); setShowVersions(false); setWfView({ type: "create" })
  }

  function newWorkflow() {
    setSelected(null); setQuery(""); setPlanError("")
    setShowHistory(false); setShowVersions(false)
    setWfView({ type: "create" })
  }

  async function handleDelete(wf: Workflow) {
    try {
      await api.deleteWorkflow(wf.id)
      setWorkflows(prev => prev.filter(w => w.id !== wf.id))
      if (selected?.id === wf.id) {
        setSelected(null)
        setWfView({ type: "create" })
        setShowHistory(false)
        setShowVersions(false)
      }
    } catch (e) { alert(String(e)) }
  }

  const showBottomBar = wfView.type === "create"

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-primary">
      <Sidebar
        workflows={workflows}
        selected={selected}
        sideLoading={sideLoading}
        onSelectWorkflow={selectWorkflow}
        onNewWorkflow={newWorkflow}
        onDelete={handleDelete}
      />
      <main className="flex flex-col flex-1 overflow-hidden">
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <WorkflowsContent
            selected={selected}
            wfView={wfView}
            showHistory={showHistory}
            showVersions={showVersions}
            reviewKey={reviewKey}
            onToggleHistory={() => { setShowHistory(x => !x); setShowVersions(false) }}
            onToggleVersions={() => { setShowVersions(x => !x); setShowHistory(false) }}
            onEditSteps={() => selected && setWfView({ type: "review", workflow: selected })}
            onRun={() => {
              if (!selected) return
              setWfView({ type: "review", workflow: selected })
            }}
            onHistorySelect={async ex => {
              if (!selected) return
              try {
                const logs = await api.getExecutionLogs(ex.id)
                setWfView({ type: "done", execution: ex, logs, workflow: selected })
              } catch (e) { alert(String(e)) }
            }}
            onApprove={handleApprove}
            onBack={() => setWfView({ type: "create" })}
            onRunAgain={handleRunAgain}
            onResume={handleResume}
            onWorkflowUpdated={syncWorkflow}
            onExecutionDone={(ex, logs, wf) =>
              setWfView({ type: "done", execution: ex, logs, workflow: wf })
            }
            onChatReview={updated => {
              syncWorkflowAndRemount(updated)
              setWfView({ type: "review", workflow: updated })
            }}
            onExampleClick={prompt => { setQuery(prompt) }}
          />
        </div>

        {/* Fixed bottom input bar */}
        {showBottomBar && (
          <BottomInputBar
            query={query}
            planning={planning}
            planError={planError}
            integrationStatuses={integrationStatuses}
            onQueryChange={setQuery}
            onPlan={handlePlan}
            onExampleClick={prompt => setQuery(prompt)}
            onRefreshStatuses={() =>
              api.getIntegrationStatus().then(setIntegrationStatuses).catch(() => {})
            }
          />
        )}
      </main>
    </div>
  )
}
