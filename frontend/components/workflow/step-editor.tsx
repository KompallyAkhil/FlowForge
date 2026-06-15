"use client"

import { useState } from "react"
import type { WorkflowStep } from "@/lib/types"
import { Btn } from "@/components/ui/button"
import { IntChip } from "@/components/ui/int-chip"

const INT_CATALOG: Record<string, {
  label: string
  actions: string[]
  defaults: Record<string, Record<string, unknown>>
}> = {
  gmail: {
    label: "Gmail",
    actions: ["search_emails", "read_emails_batch", "read_email", "send_email", "extract_invoice", "get_attachments"],
    defaults: {
      search_emails:     { query: "", max_results: 5 },
      read_emails_batch: { emails: "${step_1.emails}" },
      read_email:        { message_id: "${step_1.emails[0].id}" },
      send_email:        { to: "", subject: "", body: "" },
      extract_invoice:   { message_id: "${step_1.emails[0].id}" },
      get_attachments:   { message_id: "" },
    },
  },
  slack: {
    label: "Slack",
    actions: ["send_message", "get_messages", "create_channel", "post_notification", "list_channels"],
    defaults: {
      send_message:      { channel: "", text: "" },
      get_messages:      { channel: "", limit: 20 },
      create_channel:    { name: "", is_private: false },
      post_notification: { channel: "", title: "", text: "", type: "info" },
      list_channels:     {},
    },
  },
  sheets: {
    label: "Sheets",
    actions: ["append_row", "append_rows", "read_rows", "update_cell", "create_sheet", "search_rows", "get_spreadsheet_info"],
    defaults: {
      append_row:           { sheet: "Sheet1", values: [] },
      append_rows:          { sheet: "Sheet1", rows: [] },
      read_rows:            { sheet: "Sheet1" },
      update_cell:          { sheet: "Sheet1", cell: "A1", value: "" },
      create_sheet:         { name: "" },
      search_rows:          { sheet: "Sheet1", query: "" },
      get_spreadsheet_info: {},
    },
  },
  ai: {
    label: "AI",
    actions: ["summarize", "extract", "transform"],
    defaults: {
      summarize: { text: "", style: "bullet_points" },
      extract:   { text: "", fields: ["key_points", "action_items", "dates"] },
      transform: { text: "", instruction: "" },
    },
  },
}

const INTEGRATIONS = Object.keys(INT_CATALOG)

interface StepEditorProps {
  step?: WorkflowStep
  onSave: (step: WorkflowStep) => void
  onClose: () => void
}

function genId() {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function StepEditor({ step, onSave, onClose }: StepEditorProps) {
  const isNew = !step

  const initInt    = step?.integration?.toLowerCase() ?? "gmail"
  const initAction = step?.action ?? INT_CATALOG[initInt]?.actions[0] ?? ""

  const [name, setName]           = useState(step?.name ?? "")
  const [integration, setInt]     = useState(initInt)
  const [action, setAction]       = useState(initAction)
  const [paramsRaw, setParamsRaw] = useState(JSON.stringify(step?.params ?? {}, null, 2))
  const [err, setErr]             = useState("")

  const catalog = INT_CATALOG[integration] ?? INT_CATALOG.gmail
  const actions = catalog.actions

  function handleIntChange(int: string) {
    const cat         = INT_CATALOG[int]
    const firstAction = cat.actions[0]
    setInt(int)
    setAction(firstAction)
    setParamsRaw(JSON.stringify(cat.defaults[firstAction] ?? {}, null, 2))
    setErr("")
  }

  function handleActionChange(act: string) {
    try {
      const prevDefaults = INT_CATALOG[integration]?.defaults[action] ?? {}
      const current      = JSON.parse(paramsRaw)
      if (Object.keys(current).length === 0 || JSON.stringify(current) === JSON.stringify(prevDefaults)) {
        setParamsRaw(JSON.stringify(catalog.defaults[act] ?? {}, null, 2))
      }
    } catch {
      setParamsRaw(JSON.stringify(catalog.defaults[act] ?? {}, null, 2))
    }
    setAction(act)
    setErr("")
  }

  function save() {
    if (!name.trim()) { setErr("Step name is required"); return }
    if (!action)      { setErr("Action is required"); return }
    let params: Record<string, unknown>
    try { params = JSON.parse(paramsRaw) }
    catch { setErr("Invalid JSON — check params syntax"); return }

    onSave({
      id:          step?.id ?? genId(),
      name:        name.trim(),
      type:        "action",
      integration,
      action,
      params,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[200]"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="anim-scale-in glass-modal w-[560px] max-w-[94vw] max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <div className="font-semibold text-primary text-[15px]">
              {isNew ? "Add Step" : "Edit Step"}
            </div>
            <div className="text-[12px] text-muted mt-0.5">
              {isNew ? "Configure a new workflow step" : "Modify this step's properties"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border-0 text-muted cursor-pointer text-xl leading-none p-1 rounded-md transition-colors duration-150 hover:text-primary hover:bg-white/5"
          >×</button>
        </div>

        {/* Step name */}
        <div>
          <label className="text-[10.5px] text-muted font-semibold tracking-[0.1em] mb-1.5 block uppercase">
            Step Name
          </label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setErr("") }}
            placeholder="e.g. Search Emails"
            className="glass-input w-full text-[13.5px] text-primary px-3.5 py-2.5 rounded-lg"
          />
        </div>

        {/* Integration selector */}
        <div>
          <label className="text-[10.5px] text-muted font-semibold tracking-[0.1em] mb-1.5 block uppercase">
            Integration
          </label>
          <div className="flex gap-2 flex-wrap">
            {INTEGRATIONS.map(int => {
              const active = integration === int
              return (
                <button
                  key={int}
                  onClick={() => handleIntChange(int)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12.5px] cursor-pointer transition-all duration-150 ${
                    active
                      ? "border-accent/40 bg-accent/10 text-accent-l font-medium"
                      : "border-white/8 bg-transparent text-muted hover:bg-white/5 hover:border-white/12"
                  }`}
                >
                  <IntChip name={int} size={18} />
                  {INT_CATALOG[int].label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Action selector */}
        <div>
          <label className="text-[10.5px] text-muted font-semibold tracking-[0.1em] mb-1.5 block uppercase">
            Action
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {actions.map(act => {
              const active = action === act
              return (
                <button
                  key={act}
                  onClick={() => handleActionChange(act)}
                  className={`px-3 py-1 rounded-md border text-[11.5px] cursor-pointer font-mono transition-all duration-150 ${
                    active
                      ? "border-accent/35 bg-accent/10 text-accent-l font-semibold"
                      : "border-white/8 bg-transparent text-muted hover:bg-white/5 hover:border-white/12"
                  }`}
                >
                  {act}
                </button>
              )
            })}
          </div>
        </div>

        {/* Params */}
        <div>
          <label className="text-[10.5px] text-muted font-semibold tracking-[0.1em] mb-1.5 block uppercase">
            Parameters (JSON)
          </label>
          <textarea
            value={paramsRaw}
            onChange={e => { setParamsRaw(e.target.value); setErr("") }}
            spellCheck={false}
            className={`glass-input w-full min-h-[150px] font-mono text-[12px] resize-y leading-relaxed px-3.5 py-2.5 rounded-lg ${
              err.includes("JSON") ? "!border-danger" : ""
            }`}
          />
          {err && <div className="text-danger text-[12px] mt-1.5">{err}</div>}
        </div>

        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={onClose} small>Cancel</Btn>
          <Btn onClick={save} small>{isNew ? "Add Step" : "Save Changes"}</Btn>
        </div>
      </div>
    </div>
  )
}
