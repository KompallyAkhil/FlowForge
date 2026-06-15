import { INT_COLOR } from "@/lib/utils"

interface IntChipProps {
  name: string
  size?: number
}

export function IntChip({ name, size = 30 }: IntChipProps) {
  const color = INT_COLOR[name] ?? "#3b82f6"
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        background: color + "20",
        border: `1px solid ${color}33`,
        color,
        fontSize: Math.round(size * 0.33),
        fontWeight: 800,
        letterSpacing: "0.03em",
        flexShrink: 0,
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  )
}
