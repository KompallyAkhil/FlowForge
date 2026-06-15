// Shared helpers — date formatting, status colors, integration colors

export function calcDuration(a: string | null, b: string | null): string | null {
  if (!a || !b) return null
  const s = (new Date(b).getTime() - new Date(a).getTime()) / 1000
  return s < 60 ? `${s.toFixed(1)}s` : `${(s / 60).toFixed(1)}m`
}

export function calcElapsed(start: string | null): string | null {
  if (!start) return null
  const s = Math.floor((Date.now() - new Date(start).getTime()) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function fmtDate(d: string): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export function statusColor(s: string): string {
  const m: Record<string, string> = {
    success:   "#22c55e",
    completed: "#22c55e",
    running:   "#3b82f6",
    pending:   "#3f3f46",
    failed:    "#ef4444",
    paused:    "#f59e0b",
    skipped:   "#f59e0b",
  }
  return m[s] ?? "#52525b"
}

// Shared design tokens
export const C = {
  canvas:   "#09090b",
  sidebar:  "#0d0d0f",
  surface:  "#18181b",
  elevated: "#27272a",
  border:   "rgba(255,255,255,0.08)",
  border2:  "rgba(255,255,255,0.14)",
  accent:   "#6366f1",
  accentL:  "#818cf8",
  text:     "#fafafa",
  muted:    "#a1a1aa",
  subtle:   "#52525b",
  success:  "#22c55e",
  warning:  "#f59e0b",
  danger:   "#ef4444",
  info:     "#3b82f6",
} as const

export const INT_COLOR: Record<string, string> = {
  gmail:   "#ea4335",
  slack:   "#7b4eb8",
  sheets:  "#0f9d58",
  ai:      "#6366f1",
  generic: "#3b82f6",
}
