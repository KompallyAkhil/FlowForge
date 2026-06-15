"use client"

import { useState } from "react"
import type { Workflow, WorkflowStep, WorkflowJson } from "@/lib/types"
import { Btn } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { StepCard } from "./step-card"
import { StepEditor } from "./step-editor"
import { SchedulePanel } from "./schedule-panel"
import * as api from "@/lib/api"

interface ReviewViewProps {
  workflow: Workflow
  onApprove: (saved: Workflow) => Promise<void>
  onSaveOnly?: (updated: Workflow) => void
  onBack: () => void
  onWorkflowUpdated?: (updated: Workflow) => void
  onReplanned?: (updated: Workflow) => void
}

export function ReviewView({ workflow, onApprove, onSaveOnly, onBack, onWorkflowUpdated, onReplanned }: ReviewViewProps) {
  const [name, setName]         = useState(workflow.name)
  const [steps, setSteps]       = useState<WorkflowStep[]>(workflow.workflow_json.steps)
  const [editing, setEditing]   = useState<WorkflowStep | null>(null)
  const [addingStep, setAdding] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [approving, setApproving] = useState(false)
  const [replanning, setReplanning] = useState(false)
  const [err, setErr]             = useState("")
  const [liveWf, setLiveWf]     = useState(workflow)

  const isSchedule = workflow.workflow_json.trigger?.type === "schedule"

  function updateStep(updated: WorkflowStep) {
    setSteps(prev => prev.map(s => s.id === updated.id ? updated : s))
  }

  function addStep(step: WorkflowStep) {
    setSteps(prev => [...prev, step])
  }

  function removeStep(stepId: string) {
    setSteps(prev => prev.filter(s => s.id !== stepId))
  }

  function moveStep(stepId: string, dir: "up" | "down") {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === stepId)
      if (idx < 0) return prev
      const next = [...prev]
      const swap = dir === "up" ? idx - 1 : idx + 1
      if (swap < 0 || swap >= next.length) return prev
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next
    })
  }

  async function doSave(): Promise<Workflow | null> {
    setSaving(true); setErr("")
    try {
      const updatedJson: WorkflowJson = { ...workflow.workflow_json, steps }
      return await api.updateWorkflow(workflow.id, {
        name: name.trim() || workflow.name,
        workflow_json: updatedJson,
      })
    } catch (e) { setErr(String(e)); return null }
    finally { setSaving(false) }
  }

  async function handleSaveOnly() {
    const saved = await doSave()
    if (saved && onSaveOnly) onSaveOnly(saved)
  }

  async function handleSaveAndExecute() {
    const saved = await doSave()
    if (!saved) return
    onWorkflowUpdated?.(saved)
    setApproving(true)
    setErr("")
    try {
      await onApprove(saved)
    } catch (e) {
      setErr(`Failed to start execution: ${String(e)}`)
      setApproving(false)
    }
  }

  function handleScheduleUpdated(updated: Workflow) {
    setLiveWf(updated)
    onWorkflowUpdated?.(updated)
  }

  async function handleReplan() {
    setReplanning(true); setErr("")
    try {
      const updated = await api.replanWorkflow(workflow.id)
      onWorkflowUpdated?.(updated)
      onReplanned?.(updated)
    } catch (e) {
      setErr(`Re-plan failed: ${String(e)}`)
    } finally {
      setReplanning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {editing && (
        <StepEditor step={editing} onSave={updateStep} onClose={() => setEditing(null)} />
      )}
      {addingStep && (
        <StepEditor onSave={addStep} onClose={() => setAdding(false)} />
      )}

      {/* Plan header */}
      <div className="glass-card-static p-5 rounded-2xl"
        style={{ borderColor: "rgba(99,102,241,0.18)" }}
      >
        <div className="mb-3">
          <label className="text-[10.5px] text-muted font-semibold tracking-[0.1em] uppercase mb-1.5 block">
            Workflow Name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="glass-input w-full text-primary text-[14px] font-medium px-3.5 py-2.5 rounded-lg"
          />
        </div>

        {workflow.workflow_json.explanation && (
          <p className="text-[13px] text-muted leading-relaxed">
            {workflow.workflow_json.explanation}
          </p>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2 mt-3 pt-3 border-t border-white/[0.06]">
          <span className="text-[12px] text-subtle">
            {steps.length} step{steps.length !== 1 ? "s" : ""} · click any step to expand
          </span>
          <button
            onClick={handleReplan}
            disabled={replanning || saving}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium border transition-all duration-150 cursor-pointer ${
              replanning || saving
                ? "border-white/5 text-subtle cursor-not-allowed opacity-50"
                : "border-accent/25 text-accent-l hover:border-accent/40 hover:bg-accent/5"
            }`}
          >
            {replanning ? <><Spinner size={10} /> Re-planning…</> : "↺ Re-plan"}
          </button>
        </div>
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={i}
            onEdit={setEditing}
            onDelete={() => removeStep(step.id)}
            onMoveUp={i > 0 ? () => moveStep(step.id, "up") : undefined}
            onMoveDown={i < steps.length - 1 ? () => moveStep(step.id, "down") : undefined}
          />
        ))}
      </div>

      {/* Add step */}
      <button
        onClick={() => setAdding(true)}
        className="w-full bg-transparent rounded-xl text-muted text-[13px] py-3 px-4 cursor-pointer text-center transition-all duration-150 hover:bg-white/[0.03] hover:text-primary"
        style={{ border: "1px dashed rgba(255,255,255,0.09)" }}
      >
        + Add step
      </button>

      {isSchedule && (
        <SchedulePanel workflow={liveWf} onUpdated={handleScheduleUpdated} />
      )}

      {err && (
        <div className="rounded-lg px-4 py-2.5 text-danger text-[12.5px]"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}
        >
          {err}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <Btn variant="ghost" onClick={onBack} disabled={saving}>Back</Btn>
        {onSaveOnly && (
          <Btn variant="ghost" onClick={handleSaveOnly} disabled={saving}>
            {saving ? <><Spinner /> Saving…</> : "Save"}
          </Btn>
        )}
        {!isSchedule && (
          <Btn onClick={handleSaveAndExecute} disabled={saving || approving} style={{ minWidth: 160 }}>
            {saving ? <><Spinner /> Saving…</>
              : approving ? <><Spinner /> Starting…</>
              : "Approve & Run →"}
          </Btn>
        )}
        {isSchedule && (
          <Btn variant="ghost" onClick={handleSaveAndExecute} disabled={saving || approving} style={{ minWidth: 160 }}>
            {saving ? <><Spinner /> Saving…</>
              : approving ? <><Spinner /> Starting…</>
              : "Save & Run Now"}
          </Btn>
        )}
      </div>
    </div>
  )
}
