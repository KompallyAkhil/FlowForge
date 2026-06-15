"use client"

import { useState, useEffect } from "react"
import type { WorkflowVersion, ChangeField } from "@/lib/types"
import { C, fmtDate } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

// ── Change-field renderer ─────────────────────────────────────────────────────

function ChangeRow({ c }: { c: ChangeField }) {
  const [paramsOpen, setParamsOpen] = useState(false)

  const pill = (text: string, color: string) => (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
      padding: "2px 7px", borderRadius: 99,
      background: color + "18", border: `1px solid ${color}33`, color,
    }}>{text}</span>
  )

  if (c.field === "name") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
      {pill("NAME", C.accentL)}
      <span style={{ color: C.subtle, textDecoration: "line-through" }}>{c.before}</span>
      <span style={{ color: C.subtle }}>→</span>
      <span style={{ color: C.text, fontWeight: 500 }}>{c.after}</span>
    </div>
  )

  if (c.field === "step_added") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
      {pill("ADDED", C.success)}
      <span style={{ color: C.text }}>{c.step_name}</span>
    </div>
  )

  if (c.field === "step_removed") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
      {pill("REMOVED", C.danger)}
      <span style={{ color: C.text, textDecoration: "line-through" }}>{c.step_name}</span>
    </div>
  )

  if (c.field === "step_name") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
      {pill("RENAMED", C.warning)}
      <span style={{ color: C.subtle, textDecoration: "line-through" }}>{c.before}</span>
      <span style={{ color: C.subtle }}>→</span>
      <span style={{ color: C.text }}>{c.after}</span>
    </div>
  )

  if (c.field === "step_action") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
      {pill("ACTION", C.info)}
      <span style={{ color: C.text, fontWeight: 500 }}>{c.step_name}</span>
      <span style={{ fontFamily: "monospace", color: C.subtle, textDecoration: "line-through" }}>{c.before}</span>
      <span style={{ color: C.subtle }}>→</span>
      <span style={{ fontFamily: "monospace", color: C.accentL }}>{c.after}</span>
    </div>
  )

  if (c.field === "step_params") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
        {pill("PARAMS", C.accentL)}
        <span style={{ color: C.text, fontWeight: 500 }}>{c.step_name}</span>
        <button
          onClick={() => setParamsOpen(o => !o)}
          style={{
            background: "none", border: `1px solid ${C.border2}`, color: C.muted,
            fontSize: 10, padding: "1px 8px", borderRadius: 5, cursor: "pointer",
          }}
        >
          {paramsOpen ? "hide diff" : "show diff"}
        </button>
      </div>
      {paramsOpen && (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.danger, fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>BEFORE</div>
            <pre style={{
              background: C.danger + "08", border: `1px solid ${C.danger}22`,
              borderRadius: 7, padding: "8px 12px", fontSize: 11,
              color: C.danger + "cc", fontFamily: "ui-monospace,'Cascadia Code',monospace",
              margin: 0, overflowX: "auto",
            }}>{JSON.stringify(c.before, null, 2)}</pre>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.success, fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>AFTER</div>
            <pre style={{
              background: C.success + "08", border: `1px solid ${C.success}22`,
              borderRadius: 7, padding: "8px 12px", fontSize: 11,
              color: C.success + "cc", fontFamily: "ui-monospace,'Cascadia Code',monospace",
              margin: 0, overflowX: "auto",
            }}>{JSON.stringify(c.after, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  )

  if (c.field === "steps_reordered") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
      {pill("REORDERED", C.warning)}
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
    <div style={{
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      overflow: "hidden",
      transition: "border-color .15s",
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 12,
          padding: "11px 14px", textAlign: "left",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = C.surface)}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        {/* Version badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, color: C.accentL,
          background: C.accent + "18", border: `1px solid ${C.accent}33`,
          borderRadius: 6, padding: "2px 9px", flexShrink: 0,
        }}>
          v{ver.version_number}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {ver.change_summary}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {fmtDate(ver.created_at)} · {ver.workflow_json.steps?.length ?? 0} steps
          </div>
        </div>

        <span style={{
          fontSize: 10, color: C.subtle, flexShrink: 0,
          transition: "transform .15s", transform: open ? "rotate(180deg)" : "none",
        }}>▼</span>
      </button>

      {/* Expanded — change details */}
      {open && (
        <div style={{
          borderTop: `1px solid ${C.border}`,
          padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {isInitial && (
            <div style={{ fontSize: 12, color: C.muted }}>
              Workflow created with {ver.workflow_json.steps?.length ?? 0} steps.
            </div>
          )}

          {!isInitial && !hasChanges && (
            <div style={{ fontSize: 12, color: C.subtle }}>No structural changes recorded.</div>
          )}

          {hasChanges && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(ver.changed_fields as ChangeField[]).map((c, i) => (
                <ChangeRow key={i} c={c} />
              ))}
            </div>
          )}

          {/* Step snapshot */}
          <div>
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              letterSpacing: "0.08em", marginBottom: 6,
            }}>
              STEP SNAPSHOT AT THIS VERSION
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(ver.workflow_json.steps ?? []).map((s, i) => (
                <div
                  key={s.id ?? i}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: C.canvas, border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: "7px 12px",
                  }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: C.muted,
                    background: C.surface, border: `1px solid ${C.border2}`,
                    borderRadius: 4, padding: "1px 6px", flexShrink: 0,
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{s.name}</span>
                  <span style={{
                    fontSize: 10, color: C.muted,
                    fontFamily: "ui-monospace,'Cascadia Code',monospace",
                  }}>
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.muted, fontSize: 13, padding: "20px 0" }}>
        <Spinner /> Loading version history…
      </div>
    )
  }

  if (!versions.length) {
    return (
      <div style={{ padding: "24px 0", color: C.subtle, fontSize: 13, textAlign: "center", lineHeight: 1.65 }}>
        No versions yet.<br />
        <span style={{ fontSize: 11 }}>Versions are saved each time the workflow is updated.</span>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
        {versions.length} saved version{versions.length !== 1 ? "s" : ""} — newest first
      </div>
      {versions.map(ver => <VersionRow key={ver.id} ver={ver} />)}
    </div>
  )
}
