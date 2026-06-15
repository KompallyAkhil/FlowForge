"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { Workflow, Execution, ExecutionLog } from "@/lib/types"
import { Spinner } from "@/components/ui/spinner"
import { Btn } from "@/components/ui/button"
import { ReviewView } from "@/components/workflow/review-view"
import { ExecutionView } from "@/components/workflow/execution-view"
import { DoneView } from "@/components/workflow/done-view"
import { HistoryPanel } from "@/components/workflow/history-panel"
import { VersionHistoryPanel } from "@/components/workflow/version-history-panel"
import { IntegrationSetup } from "@/components/workflow/integration-setup"
import * as api from "@/lib/api"

// ─── Types ────────────────────────────────────────────────────────────────────

type WfView =
  | { type: "create" }
  | { type: "review";    workflow: Workflow }
  | { type: "executing"; executionId: string; workflow: Workflow }
  | { type: "done";      execution: Execution; logs: ExecutionLog[]; workflow: Workflow }

// ─── Constants ────────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "Search for unread emails from support@company.com, summarize with AI, and post to #support on Slack",
  "Find emails from billing@service.com, extract invoice amounts, and log to Google Sheets",
  "Get the 5 most recent emails from my inbox and summarize each one",
]

const INTEGRATIONS = [
  { name: "Gmail",  color: "#ea4335" },
  { name: "Slack",  color: "#7b4eb8" },
  { name: "Sheets", color: "#0f9d58" },
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

// ─── Main content ─────────────────────────────────────────────────────────────

interface WorkflowsContentProps {
  selected: Workflow | null
  wfView: WfView
  query: string
  planning: boolean
  planError: string
  showHistory: boolean
  showVersions: boolean
  onQueryChange: (q: string) => void
  onPlan: () => void
  onToggleHistory: () => void
  onToggleVersions: () => void
  onEditSteps: () => void
  onRun: () => void
  onHistorySelect: (ex: Execution) => void
  onApprove: (wf: Workflow) => void
  onSaveOnly: (wf: Workflow) => void
  onBack: () => void
  onRunAgain: (wf: Workflow) => void
  onResume: (id: string, wf: Workflow) => void
  onWorkflowUpdated: (wf: Workflow) => void
  onExecutionDone: (ex: Execution, logs: ExecutionLog[], wf: Workflow) => void
  onChatReview: (wf: Workflow) => void
  onReplan: (wf: Workflow) => void
}

function WorkflowsContent({
  selected, wfView, query, planning, planError, showHistory, showVersions,
  onQueryChange, onPlan, onToggleHistory, onToggleVersions, onEditSteps, onRun, onHistorySelect,
  onApprove, onSaveOnly, onBack, onRunAgain, onResume, onWorkflowUpdated, onExecutionDone,
  onChatReview, onReplan,
}: WorkflowsContentProps) {

  const pageTitle = () => {
    if (wfView.type === "review")    return "Review Plan"
    if (wfView.type === "executing") return "Executing"
    if (wfView.type === "done")
      return wfView.execution.status === "failed" ? "Execution Failed" : "Execution Complete"
    if (selected && showHistory)     return "Execution History"
    if (selected && showVersions)    return "Version History"
    return selected ? selected.name : null
  }

  const title = pageTitle()

  return (
    <div className="max-w-[760px] mx-auto px-8 py-8 pb-24 relative">

      {/* ── Review ── */}
      {wfView.type === "review" && (
        <>
          <PageHeader
            title="Review Plan"
            subtitle={wfView.workflow.name}
            onBack={onBack}
          />
          <ReviewView
            key={(wfView as Extract<WfView, { type: "review" }>).workflow.updated_at}
            workflow={wfView.workflow}
            onApprove={onApprove}
            onSaveOnly={onSaveOnly}
            onBack={onBack}
            onWorkflowUpdated={onWorkflowUpdated}
            onReplanned={updated => {
              onWorkflowUpdated(updated)
              onChatReview(updated)
            }}
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
                <Btn small variant="ghost" onClick={() => selected && onReplan(selected)}>Re-plan</Btn>
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

          {!showHistory && !showVersions && (
            <div className="space-y-8">
              {/* Heading */}
              {!selected && (
                <div>
                  <h1 className="text-[30px] font-bold text-primary leading-tight tracking-tight">
                    What should I automate?
                  </h1>
                  <p className="text-[14px] text-muted mt-2 leading-relaxed max-w-lg">
                    Describe your task in plain English — FlowForge will build a step-by-step plan
                    using your connected services.
                  </p>
                </div>
              )}

              {/* Input */}
              <div
                className="rounded-xl overflow-hidden transition-all duration-200"
                style={{
                  background: "#111113",
                  border: "1px solid rgba(255,255,255,0.09)",
                }}
              >
                <div
                  className="focus-within:border-indigo-500/50 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.11)] rounded-xl transition-all duration-200"
                  style={{ border: "1px solid transparent" }}
                >
                  <textarea
                    value={query}
                    onChange={e => onQueryChange(e.target.value)}
                    placeholder="e.g. Search for unread emails from boss@company.com, summarize them with AI, and post to #general on Slack"
                    rows={4}
                    className="w-full bg-transparent border-0 text-primary text-[14px] px-5 pt-5 pb-3 resize-none leading-relaxed placeholder:text-zinc-600 outline-none"
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onPlan() }}
                  />
                  <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/[0.06]">
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

              {planError && (
                <div className="rounded-lg px-4 py-3 text-danger text-[13px] leading-relaxed"
                  style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}
                >
                  {planError}
                </div>
              )}

              {/* Connected integrations */}
              <div className="flex items-center gap-5">
                <span className="text-[12px] text-subtle font-medium">Connected</span>
                {INTEGRATIONS.map(({ name, color }) => (
                  <span key={name} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color }}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />
                    {name}
                  </span>
                ))}
              </div>

              {/* Examples */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle mb-3">
                  Try these
                </div>
                <div className="flex flex-col gap-0.5">
                  {EXAMPLE_PROMPTS.map(ex => (
                    <button
                      key={ex}
                      onClick={() => onQueryChange(ex)}
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
  const [integrationsReady, setIntegrationsReady] = useState<boolean | null>(null)

  useEffect(() => {
    api.getIntegrationStatus()
      .then(statuses => setIntegrationsReady(statuses.every(s => s.connected)))
      .catch(() => setIntegrationsReady(false))
  }, [])

  if (integrationsReady === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-canvas text-muted gap-2.5 text-[13px]">
        <Spinner /> Loading…
      </div>
    )
  }

  if (!integrationsReady) {
    return <IntegrationSetup onComplete={() => setIntegrationsReady(true)} />
  }

  return <WorkflowApp />
}

function WorkflowApp() {
  const [workflows, setWorkflows]       = useState<Workflow[]>([])
  const [selected, setSelected]         = useState<Workflow | null>(null)
  const [wfView, setWfView]             = useState<WfView>({ type: "create" })
  const [query, setQuery]               = useState("")
  const [planning, setPlanning]         = useState(false)
  const [planError, setPlanError]       = useState("")
  const [showHistory, setShowHistory]   = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [sideLoading, setSideLoading]   = useState(true)

  const loadWorkflows = useCallback(async () => {
    try { setWorkflows(await api.listWorkflows()) } catch { /* ignore */ }
    setSideLoading(false)
  }, [])

  useEffect(() => { loadWorkflows() }, [loadWorkflows])

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

  async function handleApprove(wf: Workflow) {
    try {
      const result = await api.approveWorkflow(wf.id, true) as Execution
      const approvedWf: Workflow = { ...wf, status: "approved" }
      setSelected(approvedWf)
      setWorkflows(prev => prev.map(w => w.id === approvedWf.id ? approvedWf : w))
      setWfView({ type: "executing", executionId: result.id, workflow: approvedWf })
    } catch (e) { alert(String(e)) }
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

  function handleSaveOnly(updated: Workflow) {
    setSelected(updated)
    setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w))
    setWfView({ type: "create" })
  }

  function selectWorkflow(wf: Workflow) {
    setSelected(wf); setShowHistory(false); setShowVersions(false); setWfView({ type: "create" })
  }

  function newWorkflow() {
    setSelected(null); setQuery(""); setPlanError("")
    setShowHistory(false); setShowVersions(false)
    setWfView({ type: "create" })
  }

  async function handleReplan(wf: Workflow) {
    try {
      const updated = await api.replanWorkflow(wf.id)
      setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w))
      setSelected(updated)
      setWfView({ type: "review", workflow: updated })
    } catch (e) { alert(`Re-plan failed: ${String(e)}`) }
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
      <main className="flex-1 overflow-y-auto">
        <WorkflowsContent
          selected={selected}
          wfView={wfView}
          query={query}
          planning={planning}
          planError={planError}
          showHistory={showHistory}
          showVersions={showVersions}
          onQueryChange={setQuery}
          onPlan={handlePlan}
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
          onSaveOnly={handleSaveOnly}
          onBack={() => setWfView({ type: "create" })}
          onRunAgain={handleRunAgain}
          onResume={handleResume}
          onWorkflowUpdated={updated => {
            setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w))
            if (selected?.id === updated.id) setSelected(updated)
          }}
          onExecutionDone={(ex, logs, wf) =>
            setWfView({ type: "done", execution: ex, logs, workflow: wf })
          }
          onChatReview={updated => {
            setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w))
            setSelected(updated)
            setWfView({ type: "review", workflow: updated })
          }}
          onReplan={handleReplan}
        />
      </main>
    </div>
  )
}
