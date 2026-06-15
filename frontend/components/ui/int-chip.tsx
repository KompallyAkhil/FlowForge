import { INT_COLOR } from "@/lib/utils"

function MailIcon() {
  return (
    <svg width="56%" height="56%" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/>
      <path d="M1.5 5.5l6.5 4.5 6.5-4.5"/>
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="56%" height="56%" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 10.5a1.5 1.5 0 01-1.5 1.5H5L2 15V3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7z"/>
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="56%" height="56%" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/>
      <line x1="1.5" y1="6" x2="14.5" y2="6"/>
      <line x1="1.5" y1="10.5" x2="14.5" y2="10.5"/>
      <line x1="6" y1="6" x2="6" y2="14.5"/>
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg width="54%" height="54%" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5L9.5 6H14l-3.8 2.8 1.5 4.7L8 10.8l-3.7 2.7 1.5-4.7L2 6h4.5z" opacity="0.95"/>
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="56%" height="56%" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-4.95l-1 1"/>
      <path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 004.95 5l1-1"/>
    </svg>
  )
}

const ICONS: Record<string, React.FC> = {
  gmail:   MailIcon,
  slack:   ChatIcon,
  sheets:  GridIcon,
  ai:      SparkleIcon,
  generic: LinkIcon,
}

interface IntChipProps {
  name: string
  size?: number
}

export function IntChip({ name, size = 30 }: IntChipProps) {
  const color = INT_COLOR[name] ?? "#60a5fa"
  const Icon  = ICONS[name] ?? LinkIcon
  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        background: color + "15",
        border: `1px solid ${color}20`,
        color,
      }}
    >
      <Icon />
    </span>
  )
}
