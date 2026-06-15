"use client"

import { useState } from "react"
import type { WorkflowStep } from "@/lib/types"
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
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <div
        className="anim-scale-in glass-modal w-[540px] max-w-[92vw] p-6 flex flex-col gap-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <IntChip name={step.integration} size={34} />
            <div>
              <div className="font-semibold text-primary text-[14px]">{step.name}</div>
              <div className="text-xs text-muted mt-0.5">
                {step.integration} · {step.action}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border-0 text-muted cursor-pointer text-xl leading-none p-1 rounded-md transition-colors duration-150 hover:text-primary hover:bg-white/5"
          >
            ×
          </button>
        </div>

        {/* JSON editor */}
        <div>
          <div className="text-[10px] text-muted font-bold tracking-[0.1em] uppercase mb-1.5">
            Parameters (JSON)
          </div>
          <textarea
            value={raw}
            onChange={e => { setRaw(e.target.value); setErr("") }}
            spellCheck={false}
            className={`glass-input w-full min-h-[220px] font-mono text-xs resize-y leading-relaxed px-3.5 py-2.5 ${
              err ? "border-danger!" : ""
            }`}
          />
          {err && <div className="text-danger text-xs mt-1.5">{err}</div>}
        </div>

        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={onClose} small>Cancel</Btn>
          <Btn onClick={save} small>Save Changes</Btn>
        </div>
      </div>
    </div>
  )
}
