"use client"

import { useState, useEffect, useRef } from "react"
import type { Execution, ExecutionLog, Workflow, WorkflowStep } from "@/lib/types"
import { C, statusColor, calcElapsed } from "@/lib/utils"
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
        // Fetch execution status and logs in parallel every tick
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
      } catch { /* ignore transient network errors */ }
      if (!cancelled) setTimeout(poll, 1500)
    }

    poll()
    return () => { cancelled = true }
  }, [executionId])

  if (!ex) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.muted, padding: 24 }}>
        <Spinner /> Connecting to execution engine…
      </div>
    )
  }

  const failedLogs  = logs.filter(l => l.status === "failed")
  const agentFixed  = logs.some((l, _, arr) =>
    l.status === "success" && arr.filter(x => x.step_index === l.step_index).length > 1
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Status banner */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        background: C.elevated, border: `1px solid ${C.border2}`, borderRadius: 10, padding: "14px 18px",
      }}>
        {ex.status === "running" ? <Spinner size={16} /> : <Dot color={statusColor(ex.status)} size={8} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>
            {ex.status === "running"
              ? `Step ${ex.current_step + 1} of ${steps.length}: ${steps[ex.current_step]?.name ?? "…"}`
              : `Execution ${ex.status}`}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {ex.id.slice(0, 8)}
            {ex.status === "running" && ex.started_at ? ` · ${calcElapsed(ex.started_at)} elapsed` : ""}
            {agentFixed ? " · ⚡ Agent recovered a step" : ""}
          </div>
        </div>
        <Badge label={ex.status} color={statusColor(ex.status)} />
      </div>

      {/* Live error surface — shows while execution is still running */}
      {ex.status === "running" && failedLogs.length > 0 && (
        <div style={{
          background: C.warning + "0c",
          border: `1px solid ${C.warning}33`,
          borderRadius: 10,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.warning, letterSpacing: "0.07em" }}>
            RETRYING — STEP ERRORS DETECTED
          </div>
          {failedLogs.map(l => (
            <div key={l.id} style={{ fontSize: 12, color: C.warning + "cc", fontFamily: "ui-monospace, 'Cascadia Code', monospace" }}>
              Step {l.step_index + 1} · {l.step_name}: {l.error ?? "unknown error"}
              {l.retry_count > 0 && (
                <span style={{ marginLeft: 8, color: C.muted }}>({l.retry_count} retr{l.retry_count === 1 ? "y" : "ies"})</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Top-level failure error */}
      {ex.status === "failed" && ex.error && (
        <div style={{
          background: C.danger + "0c",
          border: `1px solid ${C.danger}33`,
          borderRadius: 10,
          padding: "12px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.danger, letterSpacing: "0.07em", marginBottom: 6 }}>
            EXECUTION FAILED
          </div>
          <div style={{ fontSize: 12, color: C.danger + "cc", fontFamily: "ui-monospace, 'Cascadia Code', monospace", lineHeight: 1.6 }}>
            {ex.error}
          </div>
        </div>
      )}

      {/* Steps — now receive live logs so errors, retries and agent-fix badges render immediately */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
