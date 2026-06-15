"use client"

import { useState } from "react"
import type { WorkflowStep, ExecutionLog } from "@/lib/types"
import { C, statusColor, calcDuration } from "@/lib/utils"
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
  const st = stepStatus ?? "pending"
  const col = statusColor(st)
  const agentFixed = allStepLogs && allStepLogs.length > 1 && log?.status === "success"

  return (
    <div
      className="anim-fade"
      style={{
        background: C.surface,
        border: `1px solid ${st === "running" ? C.info + "44" : C.border}`,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: st === "running" ? `0 0 0 2px ${C.info}14` : "none",
        transition: "border-color .25s, box-shadow .25s",
      }}
    >
      {/* Header row */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
        onClick={() => setOpen(x => !x)}
      >
        <IntChip name={step.integration} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontWeight: 500, fontSize: 13, color: C.text }}>
              {index + 1}. {step.name}
            </span>
            {st === "running" && <LiveDot />}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{step.action}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {stepStatus && <Badge label={st} color={col} />}

          {agentFixed && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: C.accentL,
              background: C.accent + "18", border: `1px solid ${C.accent}33`,
              borderRadius: 99, padding: "2px 8px",
            }}>
              ⚡ Agent fixed
            </span>
          )}

          {st === "running" && runningElapsed && (
            <span style={{ fontSize: 11, color: C.info }}>{runningElapsed}</span>
          )}

          {log && st !== "running" && calcDuration(log.created_at, log.updated_at ?? log.created_at) && (
            <span style={{ fontSize: 11, color: C.muted }}>
              {calcDuration(log.created_at, log.updated_at ?? log.created_at)}
            </span>
          )}

          {onEdit && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(step) }}
              style={{
                background: "none", border: `1px solid ${C.border2}`, color: C.muted,
                borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer",
                transition: "color .12s, border-color .12s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.color = C.text
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.subtle
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.color = C.muted
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.border2
              }}
            >
              Edit
            </button>
          )}

          {onMoveUp && (
            <button
              onClick={e => { e.stopPropagation(); onMoveUp() }}
              title="Move up"
              style={{
                background: "none", border: `1px solid ${C.border2}`, color: C.muted,
                borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer",
                transition: "color .12s, border-color .12s", lineHeight: 1,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.color = C.text
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.subtle
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.color = C.muted
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.border2
              }}
            >↑</button>
          )}

          {onMoveDown && (
            <button
              onClick={e => { e.stopPropagation(); onMoveDown() }}
              title="Move down"
              style={{
                background: "none", border: `1px solid ${C.border2}`, color: C.muted,
                borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer",
                transition: "color .12s, border-color .12s", lineHeight: 1,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.color = C.text
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.subtle
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.color = C.muted
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.border2
              }}
            >↓</button>
          )}

          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              title="Remove step"
              style={{
                background: "none", border: `1px solid ${C.danger}44`, color: C.danger,
                borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer",
                transition: "background .12s, border-color .12s", lineHeight: 1,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = C.danger + "15"
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.danger + "88"
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "none"
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.danger + "44"
              }}
            >×</button>
          )}

          <span style={{ color: C.subtle, fontSize: 10, transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }}>
            ▼
          </span>
        </div>
      </div>

      {/* Expanded details */}
      {open && (
        <div
          className="anim-slide"
          style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, fontWeight: 700, letterSpacing: "0.08em" }}>PARAMS</div>
            <pre className="code-block">{JSON.stringify(step.params, null, 2)}</pre>
          </div>

          {st === "skipped" && Boolean(log?.output_data?.reason) && (
            <div style={{
              background: C.warning + "0c", border: `1px solid ${C.warning}33`,
              borderRadius: 8, padding: "10px 14px",
            }}>
              <div style={{ fontSize: 11, color: C.warning, fontWeight: 600, marginBottom: 4 }}>SKIPPED — No upstream results</div>
              <div style={{ fontSize: 12, color: C.warning + "cc" }}>{String(log?.output_data?.reason ?? "")}</div>
            </div>
          )}

          {st !== "skipped" && log?.output_data && Object.keys(log.output_data).length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: C.success, marginBottom: 6, fontWeight: 700, letterSpacing: "0.08em" }}>OUTPUT</div>
              <pre className="code-block" style={{ color: C.success + "cc" }}>
                {JSON.stringify(log.output_data, null, 2)}
              </pre>
            </div>
          )}

          {log?.error && (
            <div>
              <div style={{ fontSize: 10, color: C.danger, marginBottom: 6, fontWeight: 700, letterSpacing: "0.08em" }}>
                ERROR{log.retry_count > 0 ? ` (${log.retry_count} retries)` : ""}
              </div>
              <div style={{
                background: C.danger + "0c", border: `1px solid ${C.danger}33`,
                borderRadius: 8, padding: "10px 14px",
                color: C.danger, fontSize: 12,
                fontFamily: "ui-monospace, 'Cascadia Code', monospace",
                lineHeight: 1.5,
              }}>
                {log.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
