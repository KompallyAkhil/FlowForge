"use client"

import { useState, useRef, useEffect } from "react"
import type { Workflow, WorkflowChatMessage, WorkflowJson } from "@/lib/types"
import { C, INT_COLOR } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

interface Props {
  workflow: Workflow
  /** Called after saving + kicking off execution from the new step — parent navigates to executing view. */
  onRunNewSteps: (updatedWorkflow: Workflow, executionId: string) => void
  /** Called after saving to open the full review/run-all view. */
  onReview: (updatedWorkflow: Workflow) => void
  /** Called after any save so parent list stays in sync. */
  onWorkflowUpdated: (updatedWorkflow: Workflow) => void
}

const INTEGRATION_ICONS: Record<string, string> = {
  gmail: "✉️", slack: "💬", sheets: "📊", ai: "✦", generic: "⚙",
}

function StepPill({ step }: { step: { integration: string; name: string } }) {
  const color = INT_COLOR[step.integration] ?? C.muted
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: color + "18", border: `1px solid ${color}40`,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, color,
    }}>
      <span style={{ fontSize: 10 }}>{INTEGRATION_ICONS[step.integration] ?? "⚙"}</span>
      {step.name}
    </span>
  )
}

function CurrentSteps({ workflow }: { workflow: Workflow }) {
  const steps = workflow.workflow_json?.steps ?? []
  return (
    <div style={{
      background: C.elevated, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "10px 14px", marginBottom: 12,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: C.subtle, marginBottom: 8 }}>
        CURRENT STEPS ({steps.length})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {steps.map((s, i) => (
          <span key={s.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, color: C.subtle }}>{i + 1}.</span>
            <StepPill step={s} />
          </span>
        ))}
      </div>
    </div>
  )
}

function AssistantBubble({
  text, pendingJson, oldStepCount,
  onRunNew, onReview, acting,
}: {
  text: string
  pendingJson?: WorkflowJson
  oldStepCount?: number
  onRunNew: (json: WorkflowJson, startFrom: number) => void
  onReview: (json: WorkflowJson) => void
  acting: boolean
}) {
  const newSteps = pendingJson?.steps ?? []
  const prevCount = oldStepCount ?? newSteps.length
  const addedCount = newSteps.length - prevCount
  const stepsWereAdded = addedCount > 0

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: `linear-gradient(135deg, ${C.accent}, ${C.accentL})`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, color: "#fff", fontWeight: 700,
      }}>✦</div>
      <div style={{ flex: 1 }}>
        <div style={{
          background: C.elevated, border: `1px solid ${C.border2}`,
          borderRadius: "4px 12px 12px 12px", padding: "10px 14px",
          fontSize: 13, color: C.text, lineHeight: 1.55,
        }}>
          {text}
        </div>

        {pendingJson && (
          <div style={{ marginTop: 8 }}>
            {/* Badge the newly added steps */}
            {stepsWereAdded && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                {newSteps.slice(prevCount).map(s => (
                  <span key={s.id} style={{
                    display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
                    background: C.success + "18", border: `1px solid ${C.success}40`,
                    color: C.success, borderRadius: 6, padding: "2px 8px",
                  }}>
                    + {s.name}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* Primary: run only the new step(s) — only shown when steps were added */}
              {stepsWereAdded && (
                <button
                  onClick={() => onRunNew(pendingJson, prevCount)}
                  disabled={acting}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: acting ? C.elevated : C.accent,
                    color: acting ? C.muted : "#fff",
                    border: "none", borderRadius: 8, padding: "7px 14px",
                    fontSize: 12, fontWeight: 600,
                    cursor: acting ? "not-allowed" : "pointer",
                  }}
                >
                  {acting
                    ? <><Spinner size={11} /> Working…</>
                    : <>▶ Run new step{addedCount > 1 ? "s" : ""} only</>}
                </button>
              )}

              {/* Secondary: full review/run-all */}
              <button
                onClick={() => onReview(pendingJson)}
                disabled={acting}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "transparent",
                  color: acting ? C.subtle : C.muted,
                  border: `1px solid ${C.border2}`,
                  borderRadius: 8, padding: "7px 14px",
                  fontSize: 12, fontWeight: 500,
                  cursor: acting ? "not-allowed" : "pointer",
                }}
              >
                {stepsWereAdded ? "Review & Run all →" : "Apply & Review →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{
        maxWidth: "75%", background: C.accent + "22", border: `1px solid ${C.accent}40`,
        borderRadius: "12px 4px 12px 12px", padding: "10px 14px",
        fontSize: 13, color: C.text, lineHeight: 1.55,
      }}>
        {text}
      </div>
    </div>
  )
}

export function WorkflowChatPanel({ workflow, onRunNewSteps, onReview, onWorkflowUpdated }: Props) {
  const [messages, setMessages] = useState<WorkflowChatMessage[]>([{
    role: "assistant",
    text: `I'm ready to help you extend "${workflow.name}". Describe what you'd like to add or change — for example, "add a step to log results to Sheets" or "also send the summary to Slack".`,
  }])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    setMessages([{
      role: "assistant",
      text: `I'm ready to help you extend "${workflow.name}". Describe what you'd like to add or change — for example, "add a step to log results to Sheets" or "also send the summary to Slack".`,
    }])
    setInput("")
  }, [workflow.id])

  async function handleSend() {
    const msg = input.trim()
    if (!msg || loading) return

    // Capture step count NOW (before AI responds) — this is the "start from" index
    const oldStepCount = workflow.workflow_json?.steps?.length ?? 0

    setMessages(prev => [...prev, { role: "user", text: msg }])
    setInput("")
    setLoading(true)

    try {
      const res = await api.chatWithWorkflow(workflow.id, msg)
      setMessages(prev => [...prev, {
        role: "assistant",
        text: res.reply,
        pendingWorkflowJson: res.workflow_json,
        oldStepCount,
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        role: "assistant",
        text: `Sorry, something went wrong: ${String(e)}`,
      }])
    } finally {
      setLoading(false)
    }
  }

  async function saveWorkflow(updatedJson: WorkflowJson): Promise<Workflow> {
    return api.updateWorkflow(workflow.id, { workflow_json: updatedJson })
  }

  async function handleRunNew(updatedJson: WorkflowJson, startFromStep: number) {
    setActing(true)
    try {
      const updated = await saveWorkflow(updatedJson)
      onWorkflowUpdated(updated)
      // Execute ONLY the newly added step(s); backend seeds prior outputs for chaining
      const execution = await api.executeWorkflow(workflow.id, { start_from_step: startFromStep })
      onRunNewSteps(updated, execution.id)
    } catch (e) {
      alert(String(e))
    } finally {
      setActing(false)
    }
  }

  async function handleReview(updatedJson: WorkflowJson) {
    setActing(true)
    try {
      const updated = await saveWorkflow(updatedJson)
      onWorkflowUpdated(updated)
      onReview(updated)
    } catch (e) {
      alert(String(e))
    } finally {
      setActing(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>
          Continue building this workflow
        </h2>
        <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.5 }}>
          Add new steps in plain English. New steps run on their own — no need to restart from scratch.
        </p>
      </div>

      <CurrentSteps workflow={workflow} />

      {/* Chat messages */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: "16px", display: "flex", flexDirection: "column",
        gap: 14, maxHeight: 380, overflowY: "auto", marginBottom: 10,
      }}>
        {messages.map((msg, i) =>
          msg.role === "user"
            ? <UserBubble key={i} text={msg.text} />
            : <AssistantBubble
                key={i}
                text={msg.text}
                pendingJson={msg.pendingWorkflowJson}
                oldStepCount={msg.oldStepCount}
                onRunNew={handleRunNew}
                onReview={handleReview}
                acting={acting}
              />
        )}
        {loading && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentL})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: "#fff",
            }}>✦</div>
            <div style={{
              background: C.elevated, border: `1px solid ${C.border2}`,
              borderRadius: "4px 12px 12px 12px", padding: "10px 14px",
              display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 13,
            }}>
              <Spinner size={12} /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border2}`,
        borderRadius: 14, overflow: "hidden",
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend() }}
          placeholder='e.g. "Add a step to log the summary to Google Sheets" or "Also post results to Slack #general"'
          rows={3}
          style={{
            width: "100%", background: "transparent", border: "none",
            color: C.text, fontSize: 13, padding: "12px 14px 8px",
            resize: "none", fontFamily: "inherit", lineHeight: 1.6, outline: "none",
          }}
        />
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px 10px", borderTop: `1px solid ${C.border}`,
        }}>
          <span style={{ fontSize: 11, color: C.subtle }}>⌘↵ to send</span>
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: loading || !input.trim() ? C.elevated : C.accent,
              color: loading || !input.trim() ? C.subtle : "#fff",
              border: "none", borderRadius: 9, padding: "7px 16px",
              fontSize: 12, fontWeight: 600,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            }}
          >
            {loading ? <><Spinner size={11} /> Thinking…</> : <><span style={{ fontSize: 13 }}>✦</span> Send</>}
          </button>
        </div>
      </div>
    </div>
  )
}
