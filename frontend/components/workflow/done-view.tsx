"use client"

import { useEffect, useRef, useState } from "react"
import type { Execution, ExecutionLog, Workflow, ExecutionChatMessage } from "@/lib/types"
import { statusColor, calcDuration, fmtDate } from "@/lib/utils"
import { Btn } from "@/components/ui/button"
import { StepCard } from "./step-card"
import * as api from "@/lib/api"
import { Spinner } from "../ui/spinner"

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
  const cancelled  = execution.status === "cancelled"
  const hasSkipped = logs.some(l => l.status === "skipped")

  const resultColor = failed ? "#ef4444" : cancelled ? "#818cf8" : hasSkipped ? "#f59e0b" : "#22c55e"
  const resultTitle = failed
    ? "Execution Failed"
    : cancelled
    ? "Execution Stopped"
    : hasSkipped ? "Completed — no results found"
    : "Execution Complete"

  // Chat state
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
    <div className="flex flex-col gap-5">
      <Btn variant="ghost" small onClick={onBack} style={{ alignSelf: "flex-start" }}>
        ← Back
      </Btn>

      {/* Result banner */}
      <div
        className="glass-card-static rounded-2xl p-5 flex items-center gap-4"
        style={{ borderColor: resultColor + "22" }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 font-bold"
          style={{ background: resultColor + "12", color: resultColor }}
        >
          {failed ? "✗" : cancelled ? "⏹" : hasSkipped ? "◎" : "✓"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] text-primary">{resultTitle}</div>
          <div className="text-[12.5px] text-muted mt-0.5">
            {workflow.name}
            {calcDuration(execution.started_at, execution.completed_at)
              ? ` · ${calcDuration(execution.started_at, execution.completed_at)}`
              : ""}
            {execution.started_at ? ` · ${fmtDate(execution.started_at)}` : ""}
          </div>
          {execution.error && (
            <div className="text-danger text-[12px] mt-1 font-mono truncate">{execution.error}</div>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {(failed || cancelled) && (
            <Btn variant="warning" onClick={onResume} small>↺ Resume</Btn>
          )}
          <Btn variant={(failed || cancelled) ? "ghost" : "success"} onClick={onRunAgain} small>
            {(failed || cancelled) ? "↺ Try Again" : "▶ Run Again"}
          </Btn>
        </div>
      </div>

      {/* Step results */}
      <div>
        <div className="text-[11px] text-muted font-semibold tracking-[0.1em] uppercase mb-3">
          Step Results
        </div>
        <div className="flex flex-col gap-2">
          {steps.map((step, i) => {
            const stepLogs = logs.filter(l => l.step_index === i)
            const log = stepLogs.at(-1)
            const st = log
              ? (log.status === "success" ? "success" : log.status === "skipped" ? "skipped" : "failed")
              : (i < execution.current_step ? "success"
                : i === execution.current_step && (failed || cancelled) ? "failed" : "pending")
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

      {/* Ask about this run */}
      <div className="glass-card-static rounded-2xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-white/[0.06] flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px]"
            style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}
          >
            ✦
          </div>
          <div>
            <div className="text-[13px] font-semibold text-primary">Ask about this run</div>
            <div className="text-[12px] text-muted">
              What happened, what data was produced, what to fix
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          className="overflow-y-auto px-4 py-3 flex flex-col gap-2.5 transition-all duration-200"
          style={{ height: messages.length === 0 ? 72 : 300 }}
        >
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-[12.5px] text-subtle text-center">
                Ask anything — emails found, data written, errors, next steps…
              </span>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "text-white rounded-[12px_12px_4px_12px]"
                      : "glass-card-static rounded-[12px_12px_12px_4px] text-primary"
                  }`}
                  style={m.role === "user" ? { background: "#6366f1" } : {}}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}

          {sending && (
            <div className="flex justify-start">
              <div className="glass-card-static rounded-[12px_12px_12px_4px] px-3.5 py-2.5 text-muted text-[13px] flex items-center gap-2">
                <Spinner size={12} /> <span className="tracking-[2px] text-subtle">···</span>
              </div>
            </div>
          )}

          {chatError && (
            <div className="text-[12px] text-danger rounded-md px-2.5 py-1.5"
              style={{ background: "rgba(239,68,68,0.07)" }}
            >
              {chatError}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.06] px-3 py-2.5 flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="What emails did it find? Why did step 2 fail? …"
            rows={1}
            className="glass-input flex-1 px-3 py-2 text-[13px] resize-none leading-relaxed min-h-[36px] max-h-[120px] overflow-y-auto"
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
