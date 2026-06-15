import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "FlowForge — AI Workflow Automation",
  description: "Automate anything with AI. Connect Gmail, Slack, and Google Sheets using natural language.",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full m-0 antialiased">{children}</body>
    </html>
  )
}
