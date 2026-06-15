import { Dot } from "./dot"

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 9px",
        borderRadius: 99,
        background: color + "1a",
        color,
        border: `1px solid ${color}33`,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.03em",
        textTransform: "capitalize",
        whiteSpace: "nowrap",
      }}
    >
      <Dot color={color} size={5} />
      {label}
    </span>
  )
}
