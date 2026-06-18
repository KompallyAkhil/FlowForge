"use client"

import { useState, useEffect, useRef } from "react"
import type { Execution, ExecutionLog, PendingInput, Workflow, WorkflowStep } from "@/lib/types"
import { statusColor, calcElapsed } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import { Dot } from "@/components/ui/dot"
import { Badge } from "@/components/ui/badge"
import { Btn } from "@/components/ui/button"
import { StepCard } from "./step-card"
import * as api from "@/lib/api"

const TERMINAL = new Set(["success", "failed", "cancelled"])

function deriveStepStatus(
  stepIndex: number,
  ex: Execution,
  logs: ExecutionLog[],
): "pending" | "running" | "success" | "failed" | "skipped" {
  const stepLogs = logs.filter(l => l.step_index === stepIndex)
  const log = stepLogs.at(-1)
  if (log) {
    if (log.status === "success") return "success"
    if (log.status === "skipped") return "skipped"
    return "failed"
  }
  if (ex.status === "running" && stepIndex === ex.current_step) return "running"
  if (ex.status === "failed"  && stepIndex === ex.current_step) return "failed"
  if (stepIndex < ex.current_step) return "success"
  return "pending"
}

// ── Human-in-the-loop prompt card ────────────────────────────────────────────

interface HumanInputCardProps {
  pendingInput: PendingInput
  onRespond: (choice: "create" | "skip") => void
  responding: boolean
}

function HumanInputCard({ pendingInput, onRespond, responding }: HumanInputCardProps) {
  const integrationLabel = pendingInput.integration === "slack" ? "Slack channel" : "Sheet tab"
  const resourceLabel = pendingInput.integration === "slack"
    ? `#${pendingInput.resource_name}`
    : `"${pendingInput.resource_name}"`

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)" }}
    >
      <div>
        <div className="text-[11px] font-semibold tracking-[0.08em] uppercase mb-1.5 text-warning">
          Action Required
        </div>
        <div className="text-[13.5px] text-primary leading-snug">
          {pendingInput.question}
        </div>
        <div className="text-[11.5px] text-muted mt-1">
          The {integrationLabel} {resourceLabel} does not exist yet.
          Choose how to proceed.
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => onRespond("create")}
          disabled={responding}
          style={{
            padding: "6px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: responding ? "rgba(245,158,11,0.3)" : "rgba(245,158,11,0.18)",
            border: "1px solid rgba(245,158,11,0.4)",
            color: "#f59e0b",
            cursor: responding ? "not-allowed" : "pointer",
          }}
        >
          {responding ? "Creating…" : `Yes, create ${resourceLabel}`}
        </button>
        <button
          onClick={() => onRespond("skip")}
          disabled={responding}
          style={{
            padding: "6px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "var(--muted, #94a3b8)",
            cursor: responding ? "not-allowed" : "pointer",
          }}
        >
          Skip this step
        </button>
      </div>
    </div>
  )
}

interface ExecutionViewProps {
  executionId: string
  workflow: Workflow
  onDone: (ex: Execution, logs: ExecutionLog[]) => void
}

export function ExecutionView({ executionId, workflow, onDone }: ExecutionViewProps) {
  const [ex, setEx]             = useState<Execution | null>(null)
  const [logs, setLogs]         = useState<ExecutionLog[]>([])
  const [stopping, setStopping] = useState(false)
  const [responding, setResponding] = useState(false)
  const doneRef   = useRef(false)
  const onDoneRef = useRef(onDone)
  const steps     = workflow.workflow_json.steps as WorkflowStep[]

  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  useEffect(() => {
    let source: EventSource | null = null
    let closed = false

    async function loadInitialState() {
      try {
        const [data, liveLogs] = await Promise.all([
          api.getExecution(executionId),
          api.getExecutionLogs(executionId).catch(() => [] as ExecutionLog[]),
        ])
        setEx(data)
        setLogs(liveLogs)
        // Already terminal before we even opened the stream
        if (TERMINAL.has(data.status) && !doneRef.current) {
          doneRef.current = true
          onDoneRef.current(data, liveLogs)
          return
        }
      } catch { /* ignore */ }
    }

    function openStream() {
      if (closed) return
      source = new EventSource(api.executionStreamUrl(executionId))

      source.onmessage = (e: MessageEvent) => {
        if (closed) return
        let event: Record<string, unknown>
        try { event = JSON.parse(e.data) } catch { return }

        if (event.type === "heartbeat") return

        if (event.type === "step") {
          const log: ExecutionLog = {
            id:           `sse-${event.step_index}`,
            execution_id: executionId,
            step_index:   event.step_index as number,
            step_name:    event.step_name as string,
            integration:  event.integration as string,
            action:       event.action as string,
            status:       event.status as "success" | "failed" | "skipped",
            input_data:   null,
            output_data:  (event.output_data as Record<string, unknown>) ?? null,
            error:        (event.error as string) ?? null,
            retry_count:  (event.retry_count as number) ?? 0,
            created_at:   new Date().toISOString(),
            updated_at:   null,
          }
          setLogs(prev => {
            const filtered = prev.filter(l => l.step_index !== log.step_index)
            return [...filtered, log].sort((a, b) => a.step_index - b.step_index)
          })
          setEx(prev => prev ? { ...prev, current_step: event.current_step as number, status: "running" } : prev)
          return
        }

        if (event.type === "terminal") {
          source?.close()
          closed = true
          // Fetch canonical state for accurate duration_seconds / completed_at
          Promise.all([
            api.getExecution(executionId),
            api.getExecutionLogs(executionId).catch(() => [] as ExecutionLog[]),
          ]).then(([data, finalLogs]) => {
            setEx(data)
            setLogs(finalLogs)
            if (!doneRef.current) {
              doneRef.current = true
              onDoneRef.current(data, finalLogs)
            }
          }).catch(() => {})
          return
        }

        if (event.type === "waiting_input") {
          source?.close()
          closed = true
          setEx(prev => prev ? {
            ...prev,
            status:        "waiting_input",
            current_step:  event.current_step as number,
            pending_input: event.pending_input as typeof prev.pending_input,
          } : prev)
          return
        }
      }

      source.onerror = () => {
        if (closed) return
        source?.close()
        // Reconnect after a short delay if execution is still running
        if (!doneRef.current) setTimeout(openStream, 2000)
      }
    }

    loadInitialState().then(openStream)
    return () => {
      closed = true
      source?.close()
    }
  }, [executionId])

  async function handleStop() {
    if (stopping) return
    setStopping(true)
    try {
      await api.cancelExecution(executionId)
      // Polling will detect "cancelled" and call onDone automatically
    } catch {
      setStopping(false)
    }
  }

  async function handleRespond(choice: "create" | "skip") {
    if (responding) return
    setResponding(true)
    try {
      const updated = await api.respondToExecution(executionId, choice)
      setEx(updated)
      if (TERMINAL.has(updated.status)) {
        // skip or last step was completed — execution is done
        const finalLogs = await api.getExecutionLogs(executionId).catch(() => logs)
        setLogs(finalLogs)
        if (!doneRef.current) {
          doneRef.current = true
          onDoneRef.current(updated, finalLogs)
        }
        return
      }
      // Resource created or step skipped with more steps — re-open SSE stream
      doneRef.current = false
      const src = new EventSource(api.executionStreamUrl(executionId))
      src.onmessage = (e: MessageEvent) => {
        let event: Record<string, unknown>
        try { event = JSON.parse(e.data) } catch { return }
        if (event.type === "heartbeat") return
        if (event.type === "step") {
          const log: ExecutionLog = {
            id: `sse-${event.step_index}`, execution_id: executionId,
            step_index: event.step_index as number, step_name: event.step_name as string,
            integration: event.integration as string, action: event.action as string,
            status: event.status as "success" | "failed" | "skipped",
            input_data: null, output_data: (event.output_data as Record<string, unknown>) ?? null,
            error: (event.error as string) ?? null, retry_count: (event.retry_count as number) ?? 0,
            created_at: new Date().toISOString(), updated_at: null,
          }
          setLogs(prev => [...prev.filter(l => l.step_index !== log.step_index), log].sort((a, b) => a.step_index - b.step_index))
          setEx(prev => prev ? { ...prev, current_step: event.current_step as number, status: "running" } : prev)
          return
        }
        if (event.type === "terminal") {
          src.close()
          Promise.all([api.getExecution(executionId), api.getExecutionLogs(executionId).catch(() => [] as ExecutionLog[])])
            .then(([data, finalLogs]) => {
              setEx(data); setLogs(finalLogs)
              if (!doneRef.current) { doneRef.current = true; onDoneRef.current(data, finalLogs) }
            })
          return
        }
        if (event.type === "waiting_input") {
          src.close()
          setEx(prev => prev ? { ...prev, status: "waiting_input", current_step: event.current_step as number, pending_input: event.pending_input as typeof prev.pending_input } : prev)
        }
      }
      src.onerror = () => src.close()
    } catch {
      /* ignore — user can retry */
    } finally {
      setResponding(false)
    }
  }

  if (!ex) {
    return (
      <div className="flex items-center gap-2.5 text-muted py-8 text-[13px]">
        <Spinner /> Connecting to execution engine…
      </div>
    )
  }

  const failedLogs = logs.filter(l => l.status === "failed")
  const agentFixed = logs.some((l, _, arr) =>
    l.status === "success" && arr.filter(x => x.step_index === l.step_index).length > 1
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Status row */}
      <div className="glass-card-static flex items-center gap-3.5 p-4 rounded-xl">
        {ex.status === "running" ? <Spinner size={15} /> : <Dot color={statusColor(ex.status)} size={8} />}
        <div className="flex-1">
          <div className="font-medium text-[14px] text-primary">
            {ex.status === "running"
              ? `Step ${ex.current_step + 1} of ${steps.length} · ${steps[ex.current_step]?.name ?? "…"}`
              : ex.status === "waiting_input"
              ? `Paused at step ${ex.current_step + 1} · Waiting for your input`
              : ex.status === "cancelled"
              ? "Execution stopped"
              : `Execution ${ex.status}`}
          </div>
          <div className="text-[12px] text-muted mt-0.5">
            {ex.id.slice(0, 8)}
            {ex.status === "running" && ex.started_at ? ` · ${calcElapsed(ex.started_at)} elapsed` : ""}
            {agentFixed ? " · ⚡ Agent recovered a step" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ex.status === "running" && (
            <Btn variant="ghost" small onClick={handleStop} disabled={stopping}>
              {stopping ? "Stopping…" : "⏹ Stop"}
            </Btn>
          )}
          <Badge label={ex.status} color={statusColor(ex.status)} />
        </div>
      </div>

      {/* Live warnings */}
      {ex.status === "running" && failedLogs.length > 0 && (
        <div className="rounded-xl p-4 flex flex-col gap-1.5"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.22)" }}
        >
          <div className="text-[11px] font-semibold text-warning tracking-[0.08em] uppercase">
            Retrying — step errors detected
          </div>
          {failedLogs.map(l => (
            <div key={l.id} className="text-[12px] text-warning/80 font-mono">
              Step {l.step_index + 1} · {l.step_name}: {l.error ?? "unknown error"}
              {l.retry_count > 0 && (
                <span className="ml-2 text-muted">({l.retry_count} retr{l.retry_count === 1 ? "y" : "ies"})</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Top-level failure */}
      {ex.status === "failed" && ex.error && (
        <div className="rounded-xl p-4"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.22)" }}
        >
          <div className="text-[11px] font-semibold text-danger tracking-[0.08em] uppercase mb-1.5">
            Execution Failed
          </div>
          <div className="text-[12.5px] text-danger/85 font-mono leading-relaxed">{ex.error}</div>
        </div>
      )}

      {/* Cancelled banner */}
      {ex.status === "cancelled" && (
        <div className="rounded-xl p-4"
          style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.22)" }}
        >
          <div className="text-[11px] font-semibold tracking-[0.08em] uppercase mb-1" style={{ color: "#818cf8" }}>
            Stopped by user
          </div>
          <div className="text-[12.5px] font-mono leading-relaxed" style={{ color: "#818cf8" }}>
            Execution paused at step {ex.current_step + 1} · Resume to continue from here
          </div>
        </div>
      )}

      {/* Human-in-the-loop prompt */}
      {ex.status === "waiting_input" && ex.pending_input && (
        <HumanInputCard
          pendingInput={ex.pending_input}
          onRespond={handleRespond}
          responding={responding}
        />
      )}

      {/* Steps */}
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => {
          const stepLogs = logs.filter(l => l.step_index === i)
          const log      = stepLogs.at(-1)
          const st       = deriveStepStatus(i, ex, logs)
          return (
            <StepCard
              key={step.id}
              step={step}
              index={i}
              stepStatus={st}
              log={log}
              allStepLogs={stepLogs}
              runningElapsed={st === "running" ? calcElapsed(ex.started_at) : null}
            />
          )
        })}
      </div>
    </div>
  )
}
