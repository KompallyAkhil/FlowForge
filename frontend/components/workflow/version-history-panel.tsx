"use client"

import { useState, useEffect } from "react"
import type { WorkflowVersion, ChangeField } from "@/lib/types"
import { C } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

// ── Change-field renderer ─────────────────────────────────────────────────────

function ChangeRow({ c }: { c: ChangeField }) {
  const [paramsOpen, setParamsOpen] = useState(false)

  const pill = (text: string, color: string) => (
    <span
      className="text-[10px] font-semibold tracking-[0.07em] px-2 py-0.5 rounded-md"
      style={{
        background: color + "12",
        border: `1px solid ${color}22`,
        color,
      }}
    >{text}</span>
  )

  if (c.field === "name") return (
    <div className="flex items-center gap-2 text-xs text-muted">
      {pill("NAME", "#a78bfa")}
      <span className="text-subtle line-through">{c.before}</span>
      <span className="text-subtle">→</span>
      <span className="text-primary font-medium">{c.after}</span>
    </div>
  )

  if (c.field === "step_added") return (
    <div className="flex items-center gap-2 text-xs text-muted">
      {pill("ADDED", "#34d399")}
      <span className="text-primary">{c.step_name}</span>
    </div>
  )

  if (c.field === "step_removed") return (
    <div className="flex items-center gap-2 text-xs text-muted">
      {pill("REMOVED", "#fb7185")}
      <span className="text-primary line-through">{c.step_name}</span>
    </div>
  )

  if (c.field === "step_name") return (
    <div className="flex items-center gap-2 text-xs text-muted">
      {pill("RENAMED", "#fbbf24")}
      <span className="text-subtle line-through">{c.before}</span>
      <span className="text-subtle">→</span>
      <span className="text-primary">{c.after}</span>
    </div>
  )

  if (c.field === "step_action") return (
    <div className="flex items-center gap-2 text-xs text-muted">
      {pill("ACTION", "#60a5fa")}
      <span className="text-primary font-medium">{c.step_name}</span>
      <span className="font-mono text-subtle line-through">{c.before}</span>
      <span className="text-subtle">→</span>
      <span className="font-mono text-accent-l">{c.after}</span>
    </div>
  )

  if (c.field === "step_params") return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs text-muted">
        {pill("PARAMS", "#a78bfa")}
        <span className="text-primary font-medium">{c.step_name}</span>
        <button
          onClick={() => setParamsOpen(o => !o)}
          className="bg-transparent border border-white/8 text-muted text-[10px] px-2 py-0 rounded cursor-pointer hover:bg-white/5 hover:border-white/12 transition-all duration-150"
        >
          {paramsOpen ? "hide diff" : "show diff"}
        </button>
      </div>
      {paramsOpen && (
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="text-[10px] text-danger font-bold mb-1 tracking-[0.07em] uppercase">Before</div>
            <pre className="bg-danger/5 border border-danger/15 rounded-lg px-3 py-2 text-[11px] text-danger/80 font-mono m-0 overflow-x-auto">
              {JSON.stringify(c.before, null, 2)}
            </pre>
          </div>
          <div className="flex-1">
            <div className="text-[10px] text-success font-bold mb-1 tracking-[0.07em] uppercase">After</div>
            <pre className="bg-success/5 border border-success/15 rounded-lg px-3 py-2 text-[11px] text-success/80 font-mono m-0 overflow-x-auto">
              {JSON.stringify(c.after, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )

  if (c.field === "steps_reordered") return (
    <div className="flex items-center gap-2 text-xs text-muted">
      {pill("REORDERED", "#fbbf24")}
      <span>Steps were reordered</span>
    </div>
  )

  return null
}

// ── Version row ───────────────────────────────────────────────────────────────

function VersionRow({ ver }: { ver: WorkflowVersion }) {
  const [open, setOpen] = useState(false)
  const isInitial = ver.version_number === 1 && ver.change_summary === "Initial creation"
  const hasChanges = (ver.changed_fields ?? []).length > 0

  return (
    <div className="glass-card-static rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full bg-transparent border-0 cursor-pointer flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      >
        {/* Version badge */}
        <span
          className="text-[11px] font-semibold rounded-md px-2 py-0.5 shrink-0"
          style={{
            color: "#818cf8",
            background: "rgba(99,102,241,0.12)",
            border: "1px solid rgba(99,102,241,0.20)",
          }}
        >
          v{ver.version_number}
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-primary whitespace-nowrap overflow-hidden text-ellipsis">
            {ver.change_summary}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            {ver.workflow_json.steps?.length ?? 0} steps
          </div>
        </div>

        <span className={`text-[10px] text-subtle shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▼</span>
      </button>

      {/* Expanded — change details */}
      {open && (
        <div className="border-t border-white/5 px-3.5 py-3 flex flex-col gap-2.5 anim-slide">
          {isInitial && (
            <div className="text-xs text-muted">
              Workflow created with {ver.workflow_json.steps?.length ?? 0} steps.
            </div>
          )}

          {!isInitial && !hasChanges && (
            <div className="text-xs text-subtle">No structural changes recorded.</div>
          )}

          {hasChanges && (
            <div className="flex flex-col gap-2">
              {(ver.changed_fields as ChangeField[]).map((c, i) => (
                <ChangeRow key={i} c={c} />
              ))}
            </div>
          )}

          {/* Step snapshot */}
          <div>
            <div className="text-[10px] text-muted font-bold tracking-[0.1em] uppercase mb-1.5">
              Step Snapshot at This Version
            </div>
            <div className="flex flex-col gap-1">
              {(ver.workflow_json.steps ?? []).map((s, i) => (
                <div
                  key={s.id ?? i}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-1.5"
                  style={{ background: "rgba(9,9,11,0.5)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="text-[10px] font-bold text-muted bg-white/5 border border-white/8 rounded px-1.5 py-px shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-xs text-primary flex-1">{s.name}</span>
                  <span className="text-[10px] text-muted font-mono">
                    {s.integration}.{s.action}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface VersionHistoryPanelProps {
  workflowId: string
}

export function VersionHistoryPanel({ workflowId }: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    api.getWorkflowVersions(workflowId)
      .then(setVersions)
      .catch(() => setVersions([]))
      .finally(() => setLoading(false))
  }, [workflowId])

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 text-muted text-[13px] py-5">
        <Spinner /> Loading version history…
      </div>
    )
  }

  if (!versions.length) {
    return (
      <div className="py-6 text-subtle text-[13px] text-center leading-relaxed">
        No versions yet.<br />
        <span className="text-[11px]">Versions are saved each time the workflow is updated.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] text-muted mb-1">
        {versions.length} saved version{versions.length !== 1 ? "s" : ""} — newest first
      </div>
      {versions.map(ver => <VersionRow key={ver.id} ver={ver} />)}
    </div>
  )
}
