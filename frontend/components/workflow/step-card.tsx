"use client"

import { useState } from "react"
import type { WorkflowStep, ExecutionLog } from "@/lib/types"
import { statusColor, calcDuration } from "@/lib/utils"
import { IntChip } from "@/components/ui/int-chip"
import { Badge } from "@/components/ui/badge"
import { LiveDot } from "@/components/ui/dot"

type StepStatus = "pending" | "running" | "success" | "failed" | "skipped"

interface StepCardProps {
  step: WorkflowStep
  index: number
  stepStatus?: StepStatus
  log?: ExecutionLog
  allStepLogs?: ExecutionLog[]
  onEdit?: (s: WorkflowStep) => void
  onDelete?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  runningElapsed?: string | null
}

export function StepCard({ step, index, stepStatus, log, allStepLogs, onEdit, onDelete, onMoveUp, onMoveDown, runningElapsed }: StepCardProps) {
  const [open, setOpen] = useState(false)
  const st  = stepStatus ?? "pending"
  const col = statusColor(st)
  const agentFixed = allStepLogs && allStepLogs.length > 1 && log?.status === "success"

  const borderColor =
    st === "running" ? "rgba(59,130,246,0.3)"  :
    st === "success" ? "rgba(34,197,94,0.18)"  :
    st === "failed"  ? "rgba(239,68,68,0.22)"  :
    "rgba(255,255,255,0.08)"

  return (
    <div
      className="anim-fade rounded-xl overflow-hidden transition-all duration-200"
      style={{ background: "#18181b", border: `1px solid ${borderColor}` }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors duration-150 hover:bg-white/[0.02]"
        onClick={() => setOpen(x => !x)}
      >
        {/* Step index */}
        <span
          className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold shrink-0"
          style={{ background: "rgba(255,255,255,0.05)", color: "#52525b" }}
        >
          {index + 1}
        </span>

        <IntChip name={step.integration} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13.5px] text-primary truncate">{step.name}</span>
            {st === "running" && <LiveDot />}
          </div>
          <div className="text-[11.5px] text-muted mt-0.5 font-mono">
            {step.integration}.{step.action}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {stepStatus && <Badge label={st} color={col} />}

          {agentFixed && (
            <span
              className="text-[10px] font-semibold rounded-md px-2 py-0.5"
              style={{
                color: "#818cf8",
                background: "rgba(99,102,241,0.10)",
                border: "1px solid rgba(99,102,241,0.18)",
              }}
            >
              ⚡ Agent fixed
            </span>
          )}

          {st === "running" && runningElapsed && (
            <span className="text-[11px] text-info">{runningElapsed}</span>
          )}

          {log && st !== "running" && calcDuration(log.created_at, log.updated_at ?? log.created_at) && (
            <span className="text-[11px] text-muted">
              {calcDuration(log.created_at, log.updated_at ?? log.created_at)}
            </span>
          )}

          {onEdit && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(step) }}
              className="bg-transparent border border-white/8 text-muted rounded-md px-2.5 py-0.5 text-[11px] cursor-pointer transition-all duration-150 hover:bg-white/5 hover:text-primary hover:border-white/15"
            >
              Edit
            </button>
          )}

          {onMoveUp && (
            <button
              onClick={e => { e.stopPropagation(); onMoveUp() }}
              title="Move up"
              className="bg-transparent border border-white/8 text-muted rounded-md w-6 h-6 flex items-center justify-center text-[11px] cursor-pointer transition-all duration-150 hover:bg-white/5 hover:text-primary hover:border-white/15"
            >↑</button>
          )}

          {onMoveDown && (
            <button
              onClick={e => { e.stopPropagation(); onMoveDown() }}
              title="Move down"
              className="bg-transparent border border-white/8 text-muted rounded-md w-6 h-6 flex items-center justify-center text-[11px] cursor-pointer transition-all duration-150 hover:bg-white/5 hover:text-primary hover:border-white/15"
            >↓</button>
          )}

          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              title="Remove step"
              className="bg-transparent border border-danger/20 text-danger rounded-md w-6 h-6 flex items-center justify-center text-[11px] cursor-pointer transition-all duration-150 hover:bg-danger/10 hover:border-danger/40"
            >×</button>
          )}

          <span
            className="text-subtle text-[10px] transition-transform duration-200 ml-0.5"
            style={{ transform: open ? "rotate(180deg)" : "none", display: "inline-block" }}
          >
            ▾
          </span>
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div className="anim-slide px-4 pb-4 flex flex-col gap-3">
          <div className="border-t border-white/[0.06] pt-3">
            <div className="text-[10.5px] text-muted mb-2 font-semibold tracking-[0.1em] uppercase">Parameters</div>
            <pre className="code-block">{JSON.stringify(step.params, null, 2)}</pre>
          </div>

          {st === "skipped" && Boolean(log?.output_data?.reason) && (
            <div className="rounded-lg px-3.5 py-2.5" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <div className="text-[11px] text-warning font-semibold mb-1">Skipped — no upstream results</div>
              <div className="text-[12px] text-warning/80">{String(log?.output_data?.reason ?? "")}</div>
            </div>
          )}

          {st !== "skipped" && log?.output_data && Object.keys(log.output_data).length > 0 && (
            <div>
              <div className="text-[10.5px] text-success mb-2 font-semibold tracking-[0.1em] uppercase">Output</div>
              <pre className="code-block" style={{ color: "rgba(34,197,94,0.85)" }}>
                {JSON.stringify(log.output_data, null, 2)}
              </pre>
            </div>
          )}

          {log?.error && (
            <div>
              <div className="text-[10.5px] text-danger mb-2 font-semibold tracking-[0.1em] uppercase">
                Error{log.retry_count > 0 ? ` · ${log.retry_count} retr${log.retry_count === 1 ? "y" : "ies"}` : ""}
              </div>
              <div className="rounded-lg px-3.5 py-2.5 text-danger text-[12px] font-mono leading-relaxed"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}
              >
                {log.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
