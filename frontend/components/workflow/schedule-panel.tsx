"use client"

import { useState } from "react"
import type { Workflow } from "@/lib/types"
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
    <div
      className="glass-card-static rounded-xl p-5 flex flex-col gap-3 transition-colors duration-200"
      style={{ borderColor: enabled ? "rgba(34,197,94,0.22)" : undefined }}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[10.5px] text-muted font-semibold tracking-[0.1em] uppercase mb-1.5">Schedule</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] text-primary font-medium">
              {cronExpr || "—"}
            </span>
            {cronExpr && <span className="text-[11px] text-subtle">cron</span>}
          </div>
        </div>

        <button
          onClick={toggle}
          disabled={busy || !cronExpr}
          title={!cronExpr ? "No cron expression in trigger" : undefined}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all duration-150 cursor-pointer ${
            busy || !cronExpr ? "opacity-40 cursor-not-allowed!" : ""
          } ${
            enabled
              ? "border-success/25 text-success bg-success/8"
              : "border-white/10 text-muted bg-white/[0.04]"
          }`}
        >
          {busy ? (
            <Spinner size={12} />
          ) : (
            <span
              className="relative inline-block w-7 h-4 rounded-full transition-colors duration-200 shrink-0"
              style={{ background: enabled ? "#22c55e" : "rgba(63,63,70,0.8)" }}
            >
              <span
                className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left] duration-200"
                style={{ left: enabled ? 14 : 2 }}
              />
            </span>
          )}
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-[12px] text-muted whitespace-nowrap">Timezone</span>
        <select
          value={tz}
          onChange={e => handleTzChange(e.target.value)}
          disabled={busy}
          className="glass-input flex-1 text-[12.5px] px-2.5 py-1.5 cursor-pointer rounded-md"
        >
          {TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {workflow.next_run && (
        <div className={`text-[12px] ${enabled ? "text-success" : "text-muted"}`}>
          Next run: {new Date(workflow.next_run).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </div>
      )}

      {!cronExpr && (
        <p className="text-[12px] text-warning leading-relaxed">
          No cron expression found. Re-plan this workflow with a schedule description
          (e.g. "every morning at 7 AM") to enable scheduling.
        </p>
      )}

      {err && <div className="text-[12px] text-danger">{err}</div>}
    </div>
  )
}
