"use client"

import { useState } from "react"
import type { Workflow } from "@/lib/types"
import { C } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

const TIMEZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Kolkata", "Asia/Tokyo", "Asia/Singapore",
  "Australia/Sydney",
]

interface SchedulePanelProps {
  workflow: Workflow
  onUpdated: (updated: Workflow) => void
}

export function SchedulePanel({ workflow, onUpdated }: SchedulePanelProps) {
  const isSchedule = workflow.workflow_json.trigger?.type === "schedule"
  const cronExpr   = workflow.workflow_json.trigger?.condition ?? ""
  const [enabled, setEnabled] = useState(workflow.schedule_enabled)
  const [tz, setTz]           = useState(workflow.schedule_timezone || "UTC")
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState("")

  if (!isSchedule) return null

  async function toggle() {
    setBusy(true); setErr("")
    try {
      const updated = enabled
        ? await api.disableSchedule(workflow.id)
        : await api.enableSchedule(workflow.id, tz)
      setEnabled(updated.schedule_enabled)
      onUpdated(updated)
    } catch (e) { setErr(String(e)) }
    finally { setBusy(false) }
  }

  async function handleTzChange(newTz: string) {
    setTz(newTz)
    if (!enabled) return
    setBusy(true); setErr("")
    try { onUpdated(await api.updateSchedule(workflow.id, true, newTz)) }
    catch (e) { setErr(String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{
      background: enabled ? C.success + "08" : C.surface,
      border: `1px solid ${enabled ? C.success + "33" : C.border2}`,
      borderRadius: 10, padding: "16px 20px",
      display: "flex", flexDirection: "column", gap: 12,
      transition: "background .2s, border-color .2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>
            SCHEDULE
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: C.text, fontWeight: 600 }}>
              {cronExpr || "—"}
            </span>
            {cronExpr && <span style={{ fontSize: 11, color: C.muted }}>cron expression</span>}
          </div>
        </div>

        <button
          onClick={toggle}
          disabled={busy || !cronExpr}
          title={!cronExpr ? "No cron expression in trigger" : ""}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 14px", borderRadius: 8,
            cursor: busy || !cronExpr ? "not-allowed" : "pointer",
            background: enabled ? C.success + "20" : C.border2 + "80",
            border: `1px solid ${enabled ? C.success + "44" : C.border2}`,
            color: enabled ? C.success : C.muted,
            fontSize: 12, fontWeight: 600,
            transition: "all .15s",
            opacity: busy || !cronExpr ? 0.5 : 1,
          }}
        >
          {busy ? <Spinner size={12} /> : (
            <span style={{
              width: 28, height: 16, borderRadius: 99, position: "relative", display: "inline-block",
              background: enabled ? C.success : C.subtle, transition: "background .15s", flexShrink: 0,
            }}>
              <span style={{
                position: "absolute", top: 2, left: enabled ? 14 : 2,
                width: 12, height: 12, borderRadius: "50%", background: "#fff",
                transition: "left .15s",
              }} />
            </span>
          )}
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>Timezone:</div>
        <select
          value={tz}
          onChange={e => handleTzChange(e.target.value)}
          disabled={busy}
          style={{
            background: C.canvas, border: `1px solid ${C.border2}`, borderRadius: 6,
            color: C.text, fontSize: 12, padding: "5px 8px", cursor: "pointer", flex: 1,
          }}
        >
          {TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {workflow.next_run && (
        <div style={{ fontSize: 12, color: enabled ? C.success : C.muted }}>
          Next run: {new Date(workflow.next_run).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </div>
      )}

      {!cronExpr && (
        <div style={{ fontSize: 11, color: C.warning, lineHeight: 1.55 }}>
          No cron expression found. Re-plan this workflow with a schedule description
          (e.g. "every morning at 7 AM") to enable scheduling.
        </div>
      )}

      {err && <div style={{ fontSize: 12, color: C.danger }}>{err}</div>}
    </div>
  )
}
