const INTEGRATIONS = [
  { abbr: "GM", color: "#ea4335", name: "Gmail",         desc: "Search, read and send emails" },
  { abbr: "AI", color: "#8b5cf6", name: "AI Processing", desc: "Summarize, extract and transform" },
  { abbr: "SL", color: "#7b4eb8", name: "Slack",         desc: "Post messages and notifications" },
  { abbr: "SH", color: "#0f9d58", name: "Google Sheets", desc: "Log data and read records" },
]

export function IntegrationCards() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {INTEGRATIONS.map(it => (
        <div
          key={it.name}
          className="glass-card flex gap-3 items-start p-3.5 int-card-hover cursor-default"
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-extrabold shrink-0 backdrop-blur-sm"
            style={{
              background: it.color + "14",
              border: `1px solid ${it.color}25`,
              color: it.color,
              boxShadow: `0 0 12px ${it.color}08`,
            }}
          >
            {it.abbr}
          </div>
          <div>
            <div className="font-semibold text-[13px] text-primary">{it.name}</div>
            <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{it.desc}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
