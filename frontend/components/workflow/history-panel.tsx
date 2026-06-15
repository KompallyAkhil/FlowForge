"use client"

import { useState, useEffect } from "react"
import type { Execution } from "@/lib/types"
import { statusColor, calcDuration, fmtDate } from "@/lib/utils"
import { Dot } from "@/components/ui/dot"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

interface HistoryPanelProps {
  workflowId: string
  onSelect: (ex: Execution) => void
}

export function HistoryPanel({ workflowId, onSelect }: HistoryPanelProps) {
  const [execs, setExecs]     = useState<Execution[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listExecutions(workflowId)
      .then(setExecs)
      .catch(() => setExecs([]))
      .finally(() => setLoading(false))
  }, [workflowId])

  if (loading) {
    return (
      <div className="py-5 flex gap-2.5 items-center text-muted text-[13px]">
        <Spinner /> Loading history…
      </div>
    )
  }

  if (!execs.length) {
    return (
      <div className="py-6 text-subtle text-[13px] text-center leading-relaxed">
        No executions yet.
        <br />
        <span className="text-[12px]">Run this workflow to see history here.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {execs.map(ex => {
        const col = statusColor(ex.status)
        const dur = calcDuration(ex.started_at, ex.completed_at)
        return (
          <button
            key={ex.id}
            onClick={() => onSelect(ex)}
            className="flex items-center gap-3.5 bg-transparent rounded-xl px-4 py-3 cursor-pointer text-left w-full transition-colors duration-150 hover:bg-white/[0.04]"
            style={{ border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <Dot color={col} size={7} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-primary capitalize">{ex.status}</div>
              <div className="text-[11.5px] text-muted mt-0.5">
                {ex.started_at ? fmtDate(ex.started_at) : "—"}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              {dur && <span className="text-[11.5px] text-muted">{dur}</span>}
              <span className="text-[10.5px] text-subtle font-mono">{ex.id.slice(0, 8)}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
