import { C } from "@/lib/utils"

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="anim-spin"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `2px solid ${C.border2}`,
        borderTopColor: C.accentL,
        borderRadius: "50%",
        flexShrink: 0,
      }}
    />
  )
}
