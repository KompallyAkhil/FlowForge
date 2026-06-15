"use client"

import { useEffect, useRef, useState } from "react"
import type { Execution, ExecutionLog, Workflow, ExecutionChatMessage } from "@/lib/types"
import { C, statusColor, calcDuration, fmtDate } from "@/lib/utils"
import { Btn } from "@/components/ui/button"
import { StepCard } from "./step-card"
import * as api from "@/lib/api"

interface DoneViewProps {
  execution: Execution
  logs: ExecutionLog[]
  workflow: Workflow
  onRunAgain: () => void
  onResume: () => void
  onBack: () => void
}

export function DoneView({ execution, logs, workflow, onRunAgain, onResume, onBack }: DoneViewProps) {
  const steps      = workflow.workflow_json.steps
  const failed     = execution.status === "failed"
  const hasSkipped = logs.some(l => l.status === "skipped")

  const resultColor = failed ? C.danger : hasSkipped ? C.warning : C.success
  const resultIcon  = failed ? "✗" : hasSkipped ? "◎" : "✓"
  const resultTitle = failed
    ? "Execution Failed"
    : hasSkipped ? "Completed — No Results Found"
    : "Execution Completed"

  // ── Chat state ──────────────────────────────────────────────────────────────
  const [messages, setMessages]   = useState<ExecutionChatMessage[]>([])
  const [input, setInput]         = useState("")
  const [sending, setSending]     = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const bottomRef                 = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setInput("")
    setChatError(null)

    const userMsg: ExecutionChatMessage = { role: "user", content: text }
    const nextHistory = [...messages, userMsg]
    setMessages(nextHistory)
    setSending(true)

    try {
      const res = await api.chatWithExecution(execution.id, text, messages)
      setMessages([...nextHistory, { role: "assistant", content: res.reply }])
    } catch (e: unknown) {
      setChatError(e instanceof Error ? e.message : "Failed to get reply")
      setMessages(nextHistory)
    } finally {
      setSending(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Btn variant="ghost" small onClick={onBack} style={{ alignSelf: "flex-start" }}>
        ← Back
      </Btn>

      {/* Result banner */}
      <div style={{
        background: resultColor + "0c",
        border: `1px solid ${resultColor}33`,
        borderRadius: 12, padding: "18px 22px",
        display: "flex", alignItems: "center", gap: 18,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: resultColor + "22",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, color: resultColor, flexShrink: 0,
        }}>
          {resultIcon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{resultTitle}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
            {workflow.name}
            {calcDuration(execution.started_at, execution.completed_at)
              ? ` · ${calcDuration(execution.started_at, execution.completed_at)}`
              : ""}
            {execution.started_at ? ` · ${fmtDate(execution.started_at)}` : ""}
          </div>
          {execution.error && (
            <div style={{ color: C.danger, fontSize: 12, marginTop: 6, fontFamily: "monospace" }}>
              {execution.error}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          {failed && <Btn variant="warning" onClick={onResume} small>↺ Resume</Btn>}
          <Btn variant={failed ? "ghost" : "success"} onClick={onRunAgain} small>▶ Run Again</Btn>
        </div>
      </div>

      {/* Step results */}
      <div>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 10 }}>
          STEP RESULTS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((step, i) => {
            const stepLogs = logs.filter(l => l.step_index === i)
            const log = stepLogs.at(-1)
            const st = log
              ? (log.status === "success" ? "success" : log.status === "skipped" ? "skipped" : "failed")
              : (i < execution.current_step ? "success"
                : i === execution.current_step && failed ? "failed" : "pending")
            return (
              <StepCard
                key={step.id}
                step={step}
                index={i}
                stepStatus={st}
                log={log}
                allStepLogs={stepLogs}
              />
            )
          })}
        </div>
      </div>

      {/* ── Execution chat ───────────────────────────────────────────────────── */}
      <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: C.accent + "22",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, color: C.accent,
          }}>
            ✦
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Ask about this run</div>
            <div style={{ fontSize: 11, color: C.muted }}>
              Ask Aiden what happened, what data was produced, or what to fix
            </div>
          </div>
        </div>

        {/* Message history */}
        <div style={{
          height: messages.length === 0 ? 80 : 320,
          overflowY: "auto",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          transition: "height 0.2s",
        }}>
          {messages.length === 0 ? (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", gap: 8,
            }}>
              <span style={{ fontSize: 12, color: C.muted }}>
                Ask anything about what this workflow did — emails found, data written, errors, etc.
              </span>
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div style={{
                  maxWidth: "80%",
                  padding: "8px 12px",
                  borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                  background: m.role === "user" ? C.accent : C.canvas,
                  border: m.role === "user" ? "none" : `1px solid ${C.border}`,
                  color: m.role === "user" ? "#fff" : C.text,
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {m.content}
                </div>
              </div>
            ))
          )}

          {sending && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{
                padding: "8px 14px",
                borderRadius: "12px 12px 12px 4px",
                background: C.canvas,
                border: `1px solid ${C.border}`,
                color: C.muted,
                fontSize: 13,
              }}>
                <span style={{ letterSpacing: 2 }}>···</span>
              </div>
            </div>
          )}

          {chatError && (
            <div style={{
              fontSize: 12, color: C.danger,
              padding: "6px 10px",
              background: C.danger + "10",
              borderRadius: 6,
            }}>
              {chatError}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{
          borderTop: `1px solid ${C.border}`,
          padding: "10px 12px",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="What emails did it find? Why did step 2 fail? …"
            rows={1}
            style={{
              flex: 1,
              background: C.canvas,
              border: `1px solid ${C.border2}`,
              borderRadius: 8,
              padding: "8px 12px",
              color: C.text,
              fontSize: 13,
              resize: "none",
              outline: "none",
              fontFamily: "inherit",
              lineHeight: 1.5,
              minHeight: 36,
              maxHeight: 120,
              overflowY: "auto",
            }}
          />
          <Btn
            variant="primary"
            small
            onClick={send}
            disabled={!input.trim() || sending}
            style={{ flexShrink: 0, alignSelf: "flex-end" }}
          >
            Send
          </Btn>
        </div>
      </div>
    </div>
  )
}
