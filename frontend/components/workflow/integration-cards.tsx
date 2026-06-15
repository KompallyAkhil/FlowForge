import { C } from "@/lib/utils"

const INTEGRATIONS = [
  { abbr: "GM", color: "#ea4335", name: "Gmail",         desc: "Search, read and send emails" },
  { abbr: "AI", color: "#8b5cf6", name: "AI Processing", desc: "Summarize, extract and transform" },
  { abbr: "SL", color: "#7b4eb8", name: "Slack",         desc: "Post messages and notifications" },
  { abbr: "SH", color: "#0f9d58", name: "Google Sheets", desc: "Log data and read records" },
]

export function IntegrationCards() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {INTEGRATIONS.map(it => (
        <div
          key={it.name}
          style={{
            display: "flex", gap: 12, alignItems: "flex-start",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 10, padding: "13px 14px",
            transition: "border-color .15s",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = it.color + "44"}
          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = C.border}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: it.color + "18",
            border: `1px solid ${it.color}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 800, color: it.color, flexShrink: 0,
          }}>
            {it.abbr}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{it.name}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{it.desc}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
