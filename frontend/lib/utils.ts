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
    success: "#10b981", completed: "#10b981",
    running: "#3b82f6",
    pending: "#3a3a50",
    failed: "#f43f5e",
    paused: "#f59e0b", skipped: "#f59e0b",
  }
  return m[s] ?? "#6b7280"
}

// Shared design tokens — hex values so opacity suffixes work (e.g. C.accent + "1a")
export const C = {
  canvas:   "#09090f",
  sidebar:  "#0d0d16",
  surface:  "#12121c",
  elevated: "#1a1a2e",
  border:   "#1e1e30",
  border2:  "#252538",
  accent:   "#6d28d9",
  accentL:  "#8b5cf6",
  text:     "#ededf0",
  muted:    "#6b7280",
  subtle:   "#3a3a50",
  success:  "#10b981",
  warning:  "#f59e0b",
  danger:   "#f43f5e",
  info:     "#3b82f6",
} as const

export const INT_COLOR: Record<string, string> = {
  gmail:  "#ea4335",
  slack:  "#7b4eb8",
  sheets: "#0f9d58",
  ai:     "#8b5cf6",
}
