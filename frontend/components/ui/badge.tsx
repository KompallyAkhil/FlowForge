import { Dot } from "./dot"

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium tracking-wide capitalize whitespace-nowrap"
      style={{
        background: color + "12",
        color,
        border: `1px solid ${color}22`,
      }}
    >
      <Dot color={color} size={5} />
      {label}
    </span>
  )
}
