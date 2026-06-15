export function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  )
}

export function LiveDot() {
  return (
    <span
      className="anim-pulse"
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: "#3b82f6",
        flexShrink: 0,
      }}
    />
  )
}
