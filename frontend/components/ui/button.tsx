import type { CSSProperties, ReactNode } from "react"

export type BtnVariant = "primary" | "ghost" | "danger" | "success" | "warning"

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
  const base = [
    "inline-flex items-center gap-1.5 font-medium whitespace-nowrap transition-all duration-150 ease-out",
    small ? "px-3 py-1.5 text-[12px] rounded-lg" : "px-4 py-2 text-[13px] rounded-xl",
    disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
  ].join(" ")

  if (variant === "primary" && !disabled) {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className={`${base} btn-gradient text-white font-semibold`}
        style={sx}
      >
        {children}
      </button>
    )
  }

  const variants: Record<BtnVariant, string> = {
    primary: "bg-surface text-subtle border border-border",
    ghost:   "btn-ghost",
    danger:  "bg-danger/8 text-danger border border-danger/20 hover:bg-danger/14 hover:border-danger/35",
    success: "bg-success/8 text-success border border-success/20 hover:bg-success/14 hover:border-success/35",
    warning: "bg-warning/8 text-warning border border-warning/20 hover:bg-warning/14 hover:border-warning/35",
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]}`}
      style={sx}
    >
      {children}
    </button>
  )
}
