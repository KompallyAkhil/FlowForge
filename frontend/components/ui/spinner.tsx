export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="anim-spin inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        border: `2px solid rgba(255,255,255,0.08)`,
        borderTopColor: "#818cf8",
      }}
    />
  )
}
