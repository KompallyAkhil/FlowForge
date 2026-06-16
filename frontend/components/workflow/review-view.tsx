"use client"

import { useState } from "react"
import type { Workflow } from "@/lib/types"
import { Btn } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { StepCard } from "./step-card"
import { SchedulePanel } from "./schedule-panel"
import * as api from "@/lib/api"

interface ReviewViewProps {
  workflow: Workflow
  onApprove: (wf: Workflow) => Promise<void>
  onBack: () => void
  onWorkflowUpdated?: (updated: Workflow) => void
  onReplanned?: (updated: Workflow) => void
}

export function ReviewView({ workflow, onApprove, onBack, onWorkflowUpdated, onReplanned }: ReviewViewProps) {
  const [query, setQuery]         = useState(workflow.original_input)
  const [replanning, setReplanning] = useState(false)
  const [approving, setApproving]   = useState(false)
  const [err, setErr]               = useState("")
  const [liveWf, setLiveWf]         = useState(workflow)

  const steps      = workflow.workflow_json.steps
  const isSchedule = workflow.workflow_json.trigger?.type === "schedule"
  const queryChanged = query.trim() !== workflow.original_input.trim()

  async function handleReplan() {
    if (!query.trim()) return
    setReplanning(true); setErr("")
    try {
      const updated = await api.replanWorkflow(workflow.id, query.trim())
      onWorkflowUpdated?.(updated)
      onReplanned?.(updated)
    } catch (e) {
      setErr(`Re-plan failed: ${String(e)}`)
    } finally {
      setReplanning(false)
    }
  }

  async function handleApproveAndRun() {
    setApproving(true); setErr("")
    try {
      await onApprove(workflow)
    } catch (e) {
      setErr(`Failed to start execution: ${String(e)}`)
      setApproving(false)
    }
  }

  function handleScheduleUpdated(updated: Workflow) {
    setLiveWf(updated)
    onWorkflowUpdated?.(updated)
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Query editor ──────────────────────────────────────────────────── */}
      <div
        className="glass-card-static p-5 rounded-2xl"
        style={{ borderColor: "rgba(99,102,241,0.18)" }}
      >
        <label className="text-[10.5px] text-muted font-semibold tracking-[0.1em] uppercase mb-1.5 block">
          What to automate
        </label>
        <textarea
          value={query}
          onChange={e => { setQuery(e.target.value); setErr("") }}
          rows={3}
          placeholder="Describe what you want to automate…"
          className="glass-input w-full text-primary text-[13.5px] px-3.5 py-2.5 rounded-lg resize-none leading-relaxed"
        />

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
          <span className="text-[12px] text-subtle">
            {steps.length} step{steps.length !== 1 ? "s" : ""} · edit your description and re-plan to change
          </span>
          <button
            onClick={handleReplan}
            disabled={replanning || approving || !query.trim()}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium border transition-all duration-150 cursor-pointer ${
              replanning || approving || !query.trim()
                ? "border-white/5 text-subtle opacity-50 cursor-not-allowed"
                : queryChanged
                ? "border-accent/40 bg-accent/10 text-accent-l hover:border-accent/55 hover:bg-accent/15"
                : "border-white/12 text-muted hover:bg-white/5 hover:text-primary hover:border-white/20"
            }`}
          >
            {replanning ? <><Spinner size={10} /> Re-planning…</> : "↺ Re-plan"}
          </button>
        </div>
      </div>

      {/* ── Read-only step list ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <StepCard key={step.id} step={step} index={i} />
        ))}
      </div>

      {isSchedule && (
        <SchedulePanel workflow={liveWf} onUpdated={handleScheduleUpdated} />
      )}

      {err && (
        <div
          className="rounded-lg px-4 py-2.5 text-danger text-[12.5px]"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}
        >
          {err}
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="flex gap-2 justify-end pt-1">
        <Btn variant="ghost" onClick={onBack} disabled={approving || replanning}>Back</Btn>
        {!isSchedule && (
          <Btn onClick={handleApproveAndRun} disabled={approving || replanning} style={{ minWidth: 160 }}>
            {approving ? <><Spinner /> Starting…</> : "Approve & Run →"}
          </Btn>
        )}
        {isSchedule && (
          <Btn variant="ghost" onClick={handleApproveAndRun} disabled={approving || replanning} style={{ minWidth: 160 }}>
            {approving ? <><Spinner /> Starting…</> : "Save & Run Now"}
          </Btn>
        )}
      </div>

    </div>
  )
}
