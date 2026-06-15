"use client"

import { useState } from "react"
import type { WorkflowStep } from "@/lib/types"
import { C } from "@/lib/utils"
import { Btn } from "@/components/ui/button"
import { IntChip } from "@/components/ui/int-chip"

interface ParamEditorProps {
  step: WorkflowStep
  onSave: (params: Record<string, unknown>) => void
  onClose: () => void
}

export function ParamEditor({ step, onSave, onClose }: ParamEditorProps) {
  const [raw, setRaw] = useState(JSON.stringify(step.params, null, 2))
  const [err, setErr] = useState("")

  function save() {
    try { onSave(JSON.parse(raw)); onClose() }
    catch { setErr("Invalid JSON — check your syntax") }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "#000c", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
      onClick={onClose}
    >
      <div
        className="anim-slide"
        onClick={e => e.stopPropagation()}
        style={{
          background: C.elevated,
          border: `1px solid ${C.border2}`,
          borderRadius: 14,
          width: 540,
          maxWidth: "92vw",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxShadow: `0 24px 64px #00000060`,
        }}
      >
        {/* Modal header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <IntChip name={step.integration} size={34} />
            <div>
              <div style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>{step.name}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {step.integration} · {step.action}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: C.muted,
              cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px",
              borderRadius: 6, transition: "color .12s",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = C.text}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = C.muted}
          >
            ×
          </button>
        </div>

        {/* JSON editor */}
        <div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 7, fontWeight: 700, letterSpacing: "0.08em" }}>
            PARAMETERS (JSON)
          </div>
          <textarea
            value={raw}
            onChange={e => { setRaw(e.target.value); setErr("") }}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 220,
              background: C.canvas,
              border: `1px solid ${err ? C.danger : C.border2}`,
              borderRadius: 8,
              color: C.text,
              fontSize: 12,
              fontFamily: "ui-monospace, 'Cascadia Code', monospace",
              padding: "10px 14px",
              resize: "vertical",
              lineHeight: 1.65,
              transition: "border-color .15s",
            }}
            onFocus={e => { if (!err) e.target.style.borderColor = C.accent + "60" }}
            onBlur={e => { if (!err) e.target.style.borderColor = C.border2 }}
          />
          {err && <div style={{ color: C.danger, fontSize: 12, marginTop: 5 }}>{err}</div>}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={onClose} small>Cancel</Btn>
          <Btn onClick={save} small>Save Changes</Btn>
        </div>
      </div>
    </div>
  )
}
