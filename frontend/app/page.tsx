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
import { WorkflowChatPanel } from "@/components/workflow/workflow-chat"
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
  { name: "Gmail",  icon: "✉️",  desc: "Read, search & send emails",      color: "#ea4335" },
  { name: "Slack",  icon: "💬",  desc: "Send messages & manage channels", color: "#7b4eb8" },
  { name: "Sheets", icon: "📊",  desc: "Read, write & search rows",        color: "#0f9d58" },
  
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
      // Second click — confirmed
      setConfirmingId(null)
      setDeletingId(wf.id)
      onDelete(wf).finally(() => setDeletingId(null))
    } else {
      setConfirmingId(wf.id)
      timerRef.current = setTimeout(() => setConfirmingId(null), 3000)
    }
  }

  return (
    <aside className="w-64 shrink-0 bg-sidebar border-r border-border flex flex-col h-screen sticky top-0">
      {/* ── Brand ── */}
      <div className="px-4 pt-5 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-linear-to-br from-violet-700 to-violet-500 flex items-center justify-center text-white text-base font-black shrink-0 shadow-lg shadow-violet-500/25">
            F
          </div>
          <div>
            <div className="text-sm font-bold text-primary leading-none">FlowForge</div>
            <div className="text-[10px] text-muted tracking-[0.12em] mt-1">AI AUTOMATION</div>
          </div>
        </div>
      </div>

      {/* ── Workflows list ── */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="p-3 border-b border-border">
          <button
            onClick={onNewWorkflow}
            className="btn-gradient w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-white text-[13px] font-semibold border-0 cursor-pointer"
          >
            <span className="text-base leading-none">✦</span>
            New Workflow
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2.5">
          <div className="text-[9px] font-bold tracking-[0.14em] text-subtle px-2 pt-1 pb-2">
            WORKFLOWS
          </div>
          {sideLoading ? (
            <div className="flex items-center gap-2 text-muted text-xs px-2 py-3">
              <Spinner size={11} /> Loading…
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-xs text-subtle px-2 py-5 leading-relaxed">
              No workflows yet.
              <br />
              <span className="text-subtle/50 text-[11px]">Create your first one above.</span>
            </div>
          ) : (
            workflows.map(wf => {
              const isConfirming = confirmingId === wf.id
              const isDeleting   = deletingId   === wf.id
              return (
                <div key={wf.id} className="group relative">
                  <button
                    onClick={() => !isDeleting && onSelectWorkflow(wf)}
                    className={`nav-item w-full pr-7 ${selected?.id === wf.id ? "active" : ""} ${isConfirming ? "text-red-400!" : ""}`}
                  >
                    <span className="flex-1 truncate text-left text-[12px]">
                      {isDeleting ? "Deleting…" : wf.name}
                    </span>
                    {wf.schedule_enabled && !isConfirming && (
                      <span className="text-[10px] text-emerald-400 shrink-0">⏱</span>
                    )}
                  </button>

                  {/* Delete button — visible on hover, or always visible when confirming */}
                  <button
                    onClick={e => armConfirm(e, wf)}
                    title={isConfirming ? "Click again to confirm delete" : "Delete workflow"}
                    className={[
                      "absolute right-1.5 top-1/2 -translate-y-1/2",
                      "w-5 h-5 rounded flex items-center justify-center",
                      "text-[11px] font-bold transition-all duration-100 border-0 cursor-pointer",
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
      </div>
    </aside>
  )
}

// ─── Workflows content ────────────────────────────────────────────────────────

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
  onRunNewSteps: (wf: Workflow, executionId: string) => void
  onChatReview: (wf: Workflow) => void
}

function WorkflowsContent({
  selected, wfView, query, planning, planError, showHistory, showVersions,
  onQueryChange, onPlan, onToggleHistory, onToggleVersions, onEditSteps, onRun, onHistorySelect,
  onApprove, onSaveOnly, onBack, onRunAgain, onResume, onWorkflowUpdated, onExecutionDone,
  onRunNewSteps, onChatReview,
}: WorkflowsContentProps) {
  const title = () => {
    if (wfView.type === "review")    return "Review Plan"
    if (wfView.type === "executing") return "Executing"
    if (wfView.type === "done")
      return wfView.execution.status === "failed" ? "Execution Failed" : "Execution Complete"
    if (selected && showHistory)     return "Execution History"
    if (selected && showVersions)    return "Version History"
    return selected ? selected.name : "New Workflow"
  }
  const subtitle = () => {
    if (wfView.type === "review")    return wfView.workflow.name
    if (wfView.type === "executing") return `${wfView.workflow.name} · Live`
    if (wfView.type === "done")      return wfView.workflow.name
    return null
  }

  return (
    <div className="max-w-3xl mx-auto px-7 py-8 pb-20">
      {/* Page header */}
      <div className="mb-7">
        <h1 className="text-xl font-bold text-primary m-0 leading-tight">{title()}</h1>
        {subtitle() && (
          <p className="text-[13px] text-muted mt-1 m-0">{subtitle()}</p>
        )}
      </div>

      {/* ── Review ── */}
      {wfView.type === "review" && (
        <ReviewView
          workflow={wfView.workflow}
          onApprove={() => onApprove(wfView.workflow)}
          onSaveOnly={onSaveOnly}
          onBack={onBack}
          onWorkflowUpdated={updated => {
            onWorkflowUpdated(updated)
          }}
        />
      )}

      {/* ── Executing ── */}
      {wfView.type === "executing" && (
        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="font-semibold text-[15px] text-primary">{wfView.workflow.name}</div>
            <div className="text-xs text-muted mt-1">Live execution · auto-refreshing every 1.5s</div>
          </div>
          <ExecutionView
            executionId={wfView.executionId}
            workflow={wfView.workflow}
            onDone={(ex, logs) => {
              const wf = (wfView as Extract<WfView, { type: "executing" }>).workflow
              onExecutionDone(ex, logs, wf)
            }}
          />
        </div>
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
        <div className="space-y-6">
          {/* Selected workflow banner */}
          {selected && (
            <div className="bg-surface border border-border2 rounded-2xl p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14px] text-primary">{selected.name}</div>
                <div className="text-xs text-muted mt-0.5 truncate">{selected.original_input}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Btn small variant="ghost" onClick={onToggleHistory}>
                  {showHistory ? "← Back" : "History"}
                </Btn>
                <Btn small variant="ghost" onClick={onToggleVersions}>
                  {showVersions ? "← Back" : "Versions"}
                </Btn>
                <Btn small variant="ghost" onClick={onEditSteps}>✎ Edit Steps</Btn>
                <Btn small onClick={onRun}>▶ Run</Btn>
              </div>
            </div>
          )}

          {/* History panel */}
          {selected && showHistory && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="font-semibold text-primary mb-4">Execution History</div>
              <HistoryPanel workflowId={selected.id} onSelect={onHistorySelect} />
            </div>
          )}

          {/* Version history panel */}
          {selected && showVersions && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="font-semibold text-primary mb-1">Version History</div>
              <div className="text-xs text-muted mb-4">
                Every save creates a snapshot with a structured diff of what changed.
              </div>
              <VersionHistoryPanel workflowId={selected.id} />
            </div>
          )}

          {!showHistory && !showVersions && (
            <>
              {/* When a workflow is selected: show chat panel to continue building it */}
              {selected ? (
                <WorkflowChatPanel
                  workflow={selected}
                  onRunNewSteps={(updatedWf, executionId) => {
                    onWorkflowUpdated(updatedWf)
                    onRunNewSteps(updatedWf, executionId)
                  }}
                  onReview={updatedWf => {
                    onWorkflowUpdated(updatedWf)
                    onChatReview(updatedWf)
                  }}
                  onWorkflowUpdated={onWorkflowUpdated}
                />
              ) : (
                <>
                  {/* Heading */}
                  <div>
                    <h2 className="text-lg font-bold m-0 mb-1.5 leading-snug">
                      <span className="gradient-text">What should I automate?</span>
                    </h2>
                    <p className="text-[13px] text-muted m-0 leading-relaxed">
                      Describe your task in plain English — FlowForge will generate a
                      step-by-step plan using your connected integrations.
                    </p>
                  </div>

                  {/* Input box */}
                  <div className="bg-surface border border-border2 rounded-2xl overflow-hidden focus-within:border-violet-500/50 focus-within:shadow-[0_0_0_3px_rgba(109,40,217,0.08)] transition-all duration-150">
                    <textarea
                      value={query}
                      onChange={e => onQueryChange(e.target.value)}
                      placeholder="e.g. Search for unread emails from boss@company.com, summarize them with AI, and post to #general on Slack"
                      rows={4}
                      className="w-full bg-transparent border-0 text-primary text-[13.5px] px-4 pt-4 pb-3 resize-none font-[inherit] leading-relaxed placeholder:text-subtle outline-none"
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onPlan() }}
                    />
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                      <span className="text-[11px] text-subtle">⌘↵ to generate</span>
                      <button
                        onClick={onPlan}
                        disabled={planning || !query.trim()}
                        className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-[13px] font-semibold border-0 transition-all cursor-pointer ${
                          planning || !query.trim()
                            ? "bg-elevated text-subtle cursor-not-allowed"
                            : "btn-gradient text-white"
                        }`}
                      >
                        {planning
                          ? <><Spinner size={12} /> Planning…</>
                          : <><span className="text-sm leading-none">✦</span> Generate Plan</>
                        }
                      </button>
                    </div>
                  </div>

                  {planError && (
                    <div className="bg-danger/5 border border-danger/20 rounded-xl px-4 py-3 text-danger text-xs leading-relaxed">
                      {planError}
                    </div>
                  )}

                  {/* Integrations */}
                  <div>
                    <div className="text-[9px] font-bold tracking-[0.14em] text-subtle mb-3">
                      CONNECTED INTEGRATIONS
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {INTEGRATIONS.map(({ name, icon, desc, color }) => (
                        <div
                          key={name}
                          className="bg-surface border border-border rounded-xl p-3 text-center transition-all duration-150 hover:border-border2 group"
                        >
                          <div className="text-xl mb-1.5">{icon}</div>
                          <div className="text-[11px] font-bold mb-0.5" style={{ color }}>
                            {name}
                          </div>
                          <div className="text-[10px] text-subtle leading-snug">{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Example prompts */}
                  <div>
                    <div className="text-[9px] font-bold tracking-[0.14em] text-subtle mb-3">
                      TRY THESE EXAMPLES
                    </div>
                    <div className="space-y-2">
                      {EXAMPLE_PROMPTS.map(ex => (
                        <button
                          key={ex}
                          onClick={() => onQueryChange(ex)}
                          className="w-full text-left bg-transparent border border-border rounded-xl px-4 py-3 text-xs text-muted leading-relaxed transition-all duration-100 hover:bg-surface hover:text-primary hover:border-border2 cursor-pointer"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  // null = still checking, false = setup needed, true = ready
  const [integrationsReady, setIntegrationsReady] = useState<boolean | null>(null)

  useEffect(() => {
    api.getIntegrationStatus()
      .then(statuses => setIntegrationsReady(statuses.every(s => s.connected)))
      .catch(() => setIntegrationsReady(false)) // show setup screen if backend is unreachable
  }, [])

  if (integrationsReady === null) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "#0d0d12", color: "#6b7280",
        gap: 10, fontSize: 13, fontFamily: "system-ui, sans-serif",
      }}>
        Loading…
      </div>
    )
  }

  if (!integrationsReady) {
    return <IntegrationSetup onComplete={() => setIntegrationsReady(true)} />
  }

  return <WorkflowApp />
}

function WorkflowApp() {
  const [workflows, setWorkflows]     = useState<Workflow[]>([])
  const [selected, setSelected]       = useState<Workflow | null>(null)
  const [wfView, setWfView]           = useState<WfView>({ type: "create" })
  const [query, setQuery]             = useState("")
  const [planning, setPlanning]       = useState(false)
  const [planError, setPlanError]     = useState("")
  const [showHistory, setShowHistory]   = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [sideLoading, setSideLoading]   = useState(true)

  const loadWorkflows = useCallback(async () => {
    try { setWorkflows(await api.listWorkflows()) } catch { /* ignore */ }
    setSideLoading(false)
  }, [])

  useEffect(() => { loadWorkflows() }, [loadWorkflows])

  // ── Workflow handlers ───────────────────────────────────────────────────────
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
      // approveWorkflow sets status="approved" and starts execution in one atomic call
      const result = await api.approveWorkflow(wf.id, true) as Execution
      const latest = await api.getWorkflow(wf.id)
      setSelected(latest)
      setWfView({ type: "executing", executionId: result.id, workflow: latest })
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

      <main className="flex-1 overflow-y-auto bg-canvas">
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
          onRunNewSteps={(updated, executionId) => {
            setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w))
            setSelected(updated)
            setWfView({ type: "executing", executionId, workflow: updated })
          }}
          onChatReview={updated => {
            setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w))
            setSelected(updated)
            setWfView({ type: "review", workflow: updated })
          }}
        />
      </main>
    </div>
  )
}
