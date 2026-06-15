"use client"

import { useState, useEffect, useRef } from "react"
import type { Execution, ExecutionLog, Workflow, WorkflowStep } from "@/lib/types"
import { statusColor, calcElapsed } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import { Dot } from "@/components/ui/dot"
import { Badge } from "@/components/ui/badge"
import { StepCard } from "./step-card"
import * as api from "@/lib/api"

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

interface ExecutionViewProps {
  executionId: string
  workflow: Workflow
  onDone: (ex: Execution, logs: ExecutionLog[]) => void
}

export function ExecutionView({ executionId, workflow, onDone }: ExecutionViewProps) {
  const [ex, setEx]     = useState<Execution | null>(null)
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const doneRef   = useRef(false)
  const onDoneRef = useRef(onDone)
  const steps     = workflow.workflow_json.steps as WorkflowStep[]

  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      if (cancelled || doneRef.current) return
      try {
        const [data, liveLogs] = await Promise.all([
          api.getExecution(executionId),
          api.getExecutionLogs(executionId).catch(() => [] as ExecutionLog[]),
        ])
        if (!cancelled) {
          setEx(data)
          setLogs(liveLogs)
        }
        if ((data.status === "success" || data.status === "failed") && !doneRef.current) {
          doneRef.current = true
          if (!cancelled) onDoneRef.current(data, liveLogs)
          return
        }
      } catch { /* ignore transient errors */ }
      if (!cancelled) setTimeout(poll, 1500)
    }

    poll()
    return () => { cancelled = true }
  }, [executionId])

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
              : `Execution ${ex.status}`}
          </div>
          <div className="text-[12px] text-muted mt-0.5">
            {ex.id.slice(0, 8)}
            {ex.status === "running" && ex.started_at ? ` · ${calcElapsed(ex.started_at)} elapsed` : ""}
            {agentFixed ? " · ⚡ Agent recovered a step" : ""}
          </div>
        </div>
        <Badge label={ex.status} color={statusColor(ex.status)} />
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
