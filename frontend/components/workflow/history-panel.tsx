"use client"

import { useState, useEffect } from "react"
import type { Execution } from "@/lib/types"
import { C, statusColor, calcDuration, fmtDate } from "@/lib/utils"
import { Dot } from "@/components/ui/dot"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

interface HistoryPanelProps {
  workflowId: string
  onSelect: (ex: Execution) => void
}

export function HistoryPanel({ workflowId, onSelect }: HistoryPanelProps) {
  const [execs, setExecs]   = useState<Execution[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listExecutions(workflowId)
      .then(setExecs)
      .catch(() => setExecs([]))
      .finally(() => setLoading(false))
  }, [workflowId])

  if (loading) {
    return (
      <div style={{ padding: "20px 0", display: "flex", gap: 10, alignItems: "center", color: C.muted, fontSize: 13 }}>
        <Spinner /> Loading history…
      </div>
    )
  }

  if (!execs.length) {
    return (
      <div style={{ padding: "24px 0", color: C.subtle, fontSize: 13, textAlign: "center", lineHeight: 1.65 }}>
        No executions yet.<br />
        <span style={{ fontSize: 11 }}>Run this workflow to see history here.</span>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {execs.map(ex => {
        const col = statusColor(ex.status)
        return (
          <button
            key={ex.id}
            onClick={() => onSelect(ex)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "11px 14px", cursor: "pointer", textAlign: "left", width: "100%",
              transition: "background .12s, border-color .12s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = C.surface
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.border2
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "none"
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = C.border
            }}
          >
            <Dot color={col} size={7} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text, textTransform: "capitalize" }}>
                {ex.status}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {ex.started_at ? fmtDate(ex.started_at) : "—"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
              {calcDuration(ex.started_at, ex.completed_at) && (
                <span style={{ fontSize: 11, color: C.muted }}>
                  {calcDuration(ex.started_at, ex.completed_at)}
                </span>
              )}
              <span style={{ fontSize: 10, color: C.subtle, fontFamily: "monospace" }}>
                {ex.id.slice(0, 8)}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
