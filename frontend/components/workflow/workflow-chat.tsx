"use client"

import { useState, useRef, useEffect } from "react"
import type { Workflow, WorkflowJson } from "@/lib/types"

// WorkflowChatMessage is not in lib/types — define it locally
interface WorkflowChatMessage {
  role: "user" | "assistant"
  text: string
  pendingWorkflowJson?: WorkflowJson
  oldStepCount?: number
}
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
  const color = INT_COLOR[step.integration] ?? "#7a7a95"
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] backdrop-blur-sm"
      style={{
        background: color + "14",
        border: `1px solid ${color}30`,
        color,
      }}
    >
      <span className="text-[10px]">{INTEGRATION_ICONS[step.integration] ?? "⚙"}</span>
      {step.name}
    </span>
  )
}

function CurrentSteps({ workflow }: { workflow: Workflow }) {
  const steps = workflow.workflow_json?.steps ?? []
  return (
    <div className="glass-card-static rounded-xl px-3.5 py-2.5 mb-3">
      <div className="text-[10px] font-bold tracking-[0.12em] text-subtle uppercase mb-2">
        Current Steps ({steps.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {steps.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1">
            <span className="text-[10px] text-subtle">{i + 1}.</span>
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
    <div className="flex gap-2.5 items-start">
      <div className="w-7 h-7 rounded-lg shrink-0 bg-gradient-to-br from-accent to-accent-l flex items-center justify-center text-xs text-white font-bold">
        ✦
      </div>
      <div className="flex-1">
        <div className="glass-card-static rounded-[4px_12px_12px_12px] px-3.5 py-2.5 text-[13px] text-primary leading-relaxed">
          {text}
        </div>

        {pendingJson && (
          <div className="mt-2">
            {/* Badge the newly added steps */}
            {stepsWereAdded && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {newSteps.slice(prevCount).map(s => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 text-[11px] rounded-md px-2 py-0.5"
                    style={{
                      background: "rgba(52,211,153,0.12)",
                      border: "1px solid rgba(52,211,153,0.25)",
                      color: "#34d399",
                    }}
                  >
                    + {s.name}
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {/* Primary: run only the new step(s) — only shown when steps were added */}
              {stepsWereAdded && (
                <button
                  onClick={() => onRunNew(pendingJson, prevCount)}
                  disabled={acting}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold border-0 transition-all duration-200 ${
                    acting
                      ? "bg-white/5 text-muted cursor-not-allowed"
                      : "btn-gradient text-white cursor-pointer"
                  }`}
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
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${
                  acting
                    ? "bg-transparent border-white/5 text-subtle cursor-not-allowed"
                    : "btn-ghost cursor-pointer"
                }`}
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
    <div className="flex justify-end">
      <div className="max-w-[75%] bg-accent/20 border border-accent/30 rounded-[12px_4px_12px_12px] px-3.5 py-2.5 text-[13px] text-primary leading-relaxed backdrop-blur-sm">
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
    <div className="flex flex-col gap-0">
      <div className="mb-3">
        <h2 className="text-[15px] font-bold text-primary m-0 mb-1">
          Continue building this workflow
        </h2>
        <p className="text-xs text-muted m-0 leading-relaxed">
          Add new steps in plain English. New steps run on their own — no need to restart from scratch.
        </p>
      </div>

      <CurrentSteps workflow={workflow} />

      {/* Chat messages */}
      <div className="glass-card-static rounded-2xl p-4 flex flex-col gap-3.5 max-h-[380px] overflow-y-auto mb-2.5">
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
          <div className="flex gap-2.5 items-start">
            <div className="w-7 h-7 rounded-lg shrink-0 bg-gradient-to-br from-accent to-accent-l flex items-center justify-center text-xs text-white">
              ✦
            </div>
            <div className="glass-card-static rounded-[4px_12px_12px_12px] px-3.5 py-2.5 flex items-center gap-2 text-muted text-[13px]">
              <Spinner size={12} /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="glass-card-static rounded-2xl overflow-hidden">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend() }}
          placeholder='e.g. "Add a step to log the summary to Google Sheets" or "Also post results to Slack #general"'
          rows={3}
          className="w-full bg-transparent border-0 text-primary text-[13px] px-4 pt-3 pb-2 resize-none font-[inherit] leading-relaxed outline-none placeholder:text-subtle/50"
        />
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/5">
          <span className="text-[11px] text-subtle">⌘↵ to send</span>
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold border-0 transition-all duration-200 ${
              loading || !input.trim()
                ? "bg-white/5 text-subtle cursor-not-allowed"
                : "btn-gradient text-white cursor-pointer"
            }`}
          >
            {loading ? <><Spinner size={11} /> Thinking…</> : <><span className="text-[13px]">✦</span> Send</>}
          </button>
        </div>
      </div>
    </div>
  )
}
