"use client"

import { useState } from "react"
import type { Workflow, WorkflowStep, WorkflowJson } from "@/lib/types"
import { C } from "@/lib/utils"
import { Btn } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { StepCard } from "./step-card"
import { StepEditor } from "./step-editor"
import { SchedulePanel } from "./schedule-panel"
import * as api from "@/lib/api"

interface ReviewViewProps {
  workflow: Workflow
  onApprove: () => void
  onSaveOnly?: (updated: Workflow) => void
  onBack: () => void
  onWorkflowUpdated?: (updated: Workflow) => void
}

export function ReviewView({ workflow, onApprove, onSaveOnly, onBack, onWorkflowUpdated }: ReviewViewProps) {
  const [name, setName]         = useState(workflow.name)
  const [steps, setSteps]       = useState<WorkflowStep[]>(workflow.workflow_json.steps)
  const [editing, setEditing]   = useState<WorkflowStep | null>(null)
  const [addingStep, setAdding] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState("")
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
    if (saved) onApprove()
  }

  function handleScheduleUpdated(updated: Workflow) {
    setLiveWf(updated)
    onWorkflowUpdated?.(updated)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {editing && (
        <StepEditor
          step={editing}
          onSave={updateStep}
          onClose={() => setEditing(null)}
        />
      )}

      {addingStep && (
        <StepEditor
          onSave={addStep}
          onClose={() => setAdding(false)}
        />
      )}

      {/* Plan header card */}
      <div style={{
        background: C.accent + "0e",
        border: `1px solid ${C.accent}30`,
        borderRadius: 10, padding: "16px 20px",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>
            WORKFLOW NAME
          </div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={{
              width: "100%", background: C.canvas,
              border: `1px solid ${C.border2}`, borderRadius: 7,
              color: C.text, fontSize: 14, fontWeight: 600,
              padding: "7px 12px", fontFamily: "inherit",
              transition: "border-color .15s",
            }}
            onFocus={e => (e.target.style.borderColor = C.accent + "66")}
            onBlur={e => (e.target.style.borderColor = C.border2)}
          />
        </div>
        <div style={{ fontSize: 13, color: "#a78bfa", lineHeight: 1.65 }}>
          {workflow.workflow_json.explanation}
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>
          {steps.length} step{steps.length !== 1 ? "s" : ""} ·
          Click any step to expand · Edit name, integration, action or params · Reorder or remove steps
        </div>
      </div>

      {/* Steps list with reorder / delete controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
        style={{
          background: "transparent",
          border: `1px dashed ${C.border2}`,
          borderRadius: 10,
          color: C.muted,
          fontSize: 13,
          padding: "12px 16px",
          cursor: "pointer",
          textAlign: "center",
          transition: "border-color .15s, color .15s",
          width: "100%",
          fontFamily: "inherit",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = C.accent + "66"
          ;(e.currentTarget as HTMLButtonElement).style.color = C.accentL
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = C.border2
          ;(e.currentTarget as HTMLButtonElement).style.color = C.muted
        }}
      >
        + Add Step
      </button>

      {isSchedule && (
        <SchedulePanel workflow={liveWf} onUpdated={handleScheduleUpdated} />
      )}

      {err && (
        <div style={{
          background: C.danger + "0c", border: `1px solid ${C.danger}33`,
          borderRadius: 8, padding: "10px 16px", color: C.danger, fontSize: 12,
        }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
        <Btn variant="ghost" onClick={onBack} disabled={saving}>← Back</Btn>
        {onSaveOnly && (
          <Btn variant="ghost" onClick={handleSaveOnly} disabled={saving}>
            {saving ? <><Spinner /> Saving…</> : "Save Changes"}
          </Btn>
        )}
        {!isSchedule && (
          <Btn onClick={handleSaveAndExecute} disabled={saving} style={{ minWidth: 180 }}>
            {saving ? <><Spinner /> Saving…</> : "▶ Approve & Execute"}
          </Btn>
        )}
        {isSchedule && (
          <Btn variant="ghost" onClick={handleSaveAndExecute} disabled={saving} style={{ minWidth: 180 }}>
            {saving ? <><Spinner /> Saving…</> : "Save & Run Now"}
          </Btn>
        )}
      </div>
    </div>
  )
}
