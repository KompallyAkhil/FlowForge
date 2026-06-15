import type { CSSProperties, ReactNode } from "react"
import { C } from "@/lib/utils"

export type BtnVariant = "primary" | "ghost" | "danger" | "success" | "warning"

const STYLES: Record<BtnVariant, { bg: string; fg: string; bd: string; gradient?: boolean }> = {
  primary: { bg: C.accent,         fg: "#fff",      bd: "transparent",      gradient: true },
  ghost:   { bg: "transparent",    fg: C.text,      bd: C.border2 },
  danger:  { bg: C.danger + "15",  fg: C.danger,    bd: C.danger + "44" },
  success: { bg: C.success + "15", fg: C.success,   bd: C.success + "44" },
  warning: { bg: C.warning + "15", fg: C.warning,   bd: C.warning + "44" },
}

interface BtnProps {
  children: ReactNode
  onClick?: () => void
  variant?: BtnVariant
  disabled?: boolean
  small?: boolean
  style?: CSSProperties
  type?: "button" | "submit" | "reset"
}

export function Btn({
  children, onClick, variant = "primary", disabled, small, style: sx, type = "button",
}: BtnProps) {
  const s = STYLES[variant]
  const isGradient = s.gradient && !disabled

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={isGradient ? "btn-gradient" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: small ? "5px 12px" : "8px 16px",
        background: disabled ? C.surface : s.bg,
        color: disabled ? C.subtle : s.fg,
        border: `1px solid ${disabled ? C.border : s.bd}`,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: small ? 12 : 13,
        fontWeight: 500,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        ...sx,
      }}
      onMouseEnter={e => {
        if (!disabled && !isGradient) (e.currentTarget as HTMLButtonElement).style.opacity = ".82"
      }}
      onMouseLeave={e => {
        if (!disabled && !isGradient) (e.currentTarget as HTMLButtonElement).style.opacity = "1"
      }}
    >
      {children}
    </button>
  )
}
