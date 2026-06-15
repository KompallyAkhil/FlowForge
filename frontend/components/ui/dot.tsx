export function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, background: color }}
    />
  )
}

export function LiveDot() {
  return (
    <span
      className="anim-pulse inline-block rounded-full shrink-0"
      style={{ width: 7, height: 7, background: "#3b82f6" }}
    />
  )
}
