"use client"

import { useState } from "react"
import type { WorkflowStep } from "@/lib/types"
import { C } from "@/lib/utils"
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
    // Only overwrite params if they still match the previous action's defaults (or are empty)
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

  const inputBase: React.CSSProperties = {
    width: "100%",
    background: C.canvas,
    border: `1px solid ${C.border2}`,
    borderRadius: 7,
    color: C.text,
    fontSize: 13,
    padding: "7px 12px",
    fontFamily: "inherit",
    outline: "none",
    transition: "border-color .15s",
  }

  const labelBase: React.CSSProperties = {
    fontSize: 10,
    color: C.muted,
    fontWeight: 700,
    letterSpacing: "0.08em",
    marginBottom: 6,
    display: "block",
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
          width: 560,
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxShadow: "0 24px 64px #00000060",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 15 }}>
              {isNew ? "Add Step" : "Edit Step"}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {isNew ? "Configure a new workflow step" : "Modify this step's properties"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px", borderRadius: 6, transition: "color .12s" }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = C.text)}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = C.muted)}
          >×</button>
        </div>

        {/* Step name */}
        <div>
          <label style={labelBase}>STEP NAME</label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setErr("") }}
            placeholder="e.g. Search Emails"
            style={inputBase}
            onFocus={e => ((e.target as HTMLInputElement).style.borderColor = C.accent + "66")}
            onBlur={e => ((e.target as HTMLInputElement).style.borderColor = C.border2)}
          />
        </div>

        {/* Integration selector — dynamic pill buttons */}
        <div>
          <label style={labelBase}>INTEGRATION</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {INTEGRATIONS.map(int => {
              const active = integration === int
              return (
                <button
                  key={int}
                  onClick={() => handleIntChange(int)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: `1px solid ${active ? C.accent + "88" : C.border2}`,
                    background: active ? C.accent + "18" : "transparent",
                    color: active ? C.accentL : C.muted,
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  <IntChip name={int} size={18} />
                  {INT_CATALOG[int].label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Action selector — updates dynamically when integration changes */}
        <div>
          <label style={labelBase}>ACTION</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {actions.map(act => {
              const active = action === act
              return (
                <button
                  key={act}
                  onClick={() => handleActionChange(act)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: `1px solid ${active ? C.accent + "66" : C.border2}`,
                    background: active ? C.accent + "18" : "transparent",
                    color: active ? C.accentL : C.muted,
                    fontSize: 11,
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
                    transition: "all .15s",
                  }}
                >
                  {act}
                </button>
              )
            })}
          </div>
        </div>

        {/* Params JSON editor — pre-filled from action defaults */}
        <div>
          <label style={labelBase}>PARAMETERS (JSON)</label>
          <textarea
            value={paramsRaw}
            onChange={e => { setParamsRaw(e.target.value); setErr("") }}
            spellCheck={false}
            style={{
              ...inputBase,
              minHeight: 150,
              fontFamily: "ui-monospace, 'Cascadia Code', monospace",
              fontSize: 12,
              resize: "vertical",
              lineHeight: 1.65,
              borderColor: err.includes("JSON") ? C.danger : C.border2,
            }}
          />
          {err && <div style={{ color: C.danger, fontSize: 12, marginTop: 5 }}>{err}</div>}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={onClose} small>Cancel</Btn>
          <Btn onClick={save} small>{isNew ? "Add Step" : "Save Changes"}</Btn>
        </div>
      </div>
    </div>
  )
}
