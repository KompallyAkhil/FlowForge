"use client"

import { useState, useEffect, useCallback } from "react"
import type { ReactNode } from "react"
import type { IntegrationStatus } from "@/lib/types"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// ─── Icons ────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

// ─── Integration row ──────────────────────────────────────────────────────────

function IntRow({
  icon, name, desc, connected, connectedLabel, children,
}: {
  icon: ReactNode; name: string; desc: string
  connected: boolean; connectedLabel: string
  children?: ReactNode
}) {
  return (
    <div
      className="rounded-xl p-5 transition-colors duration-200"
      style={{
        background: "#18181b",
        border: `1px solid ${connected ? "rgba(34,197,94,0.22)" : "rgba(255,255,255,0.07)"}`,
      }}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-semibold text-[14px] text-primary">{name}</span>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-0.5">
                <CheckIcon /> {connectedLabel}
              </span>
            ) : (
              <span className="text-[11px] text-subtle">Not connected</span>
            )}
          </div>
          <p className="text-[12.5px] text-muted mt-1 leading-relaxed">{desc}</p>
          {!connected && children && (
            <div className="mt-3.5">{children}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Setup screen ──────────────────────────────────────────────────────────────

interface IntegrationSetupProps {
  onComplete: () => void
}

export function IntegrationSetup({ onComplete }: IntegrationSetupProps) {
  const [statuses, setStatuses]       = useState<IntegrationStatus[]>([])
  const [loading, setLoading]         = useState(true)
  const [slackToken, setSlackToken]   = useState("")
  const [savingSlack, setSavingSlack] = useState(false)
  const [slackError, setSlackError]   = useState("")

  const fetchStatus = useCallback(async () => {
    try {
      setStatuses(await api.getIntegrationStatus())
    } catch {
      setStatuses([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "integration_connected" && e.data?.integration === "google") {
        fetchStatus()
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [fetchStatus])

  const gmail  = statuses.find(s => s.integration === "gmail")
  const sheets = statuses.find(s => s.integration === "sheets")
  const slack  = statuses.find(s => s.integration === "slack")

  const googleConnected = !!gmail?.connected && !!sheets?.connected
  const allConnected    = googleConnected && !!slack?.connected
  const connectedCount  = statuses.filter(s => s.connected).length

  const connectGoogle = () => {
    const popup = window.open(
      `${BASE}/api/integrations/google/connect`,
      "google-oauth",
      "width=520,height=640,left=400,top=120,resizable=yes,scrollbars=yes",
    )
    if (!popup) return
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer)
        fetchStatus()
      }
    }, 800)
  }

  const saveSlack = async () => {
    if (!slackToken.trim()) return
    setSavingSlack(true); setSlackError("")
    try {
      await api.saveSlackToken(slackToken.trim())
      setSlackToken("")
      await fetchStatus()
    } catch (e) {
      setSlackError(String(e).replace(/^Error:\s*/, ""))
    } finally {
      setSavingSlack(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-canvas text-muted gap-2.5 text-[13px]">
        <Spinner /> Checking integrations…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[520px]">

        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[15px] shrink-0"
            style={{ background: "#6366f1" }}
          >
            F
          </div>
          <div>
            <div className="font-semibold text-[15px] text-primary leading-none">FlowForge</div>
            <div className="text-[11px] text-subtle leading-none mt-0.5">AI Automation</div>
          </div>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-[24px] font-bold text-primary leading-tight">
            Connect your services
          </h1>
          <p className="text-[14px] text-muted mt-2 leading-relaxed">
            Link Gmail, Slack, and Google Sheets so FlowForge can execute each step
            of your automated workflows.
          </p>
        </div>

        {/* Integration rows */}
        <div className="flex flex-col gap-3">

          {/* Gmail */}
          <IntRow
            icon={<GmailIcon />}
            name="Gmail"
            desc="Read, search, and send emails from your inbox"
            connected={!!gmail?.connected}
            connectedLabel="Connected"
          >
            <button
              onClick={connectGoogle}
              className="inline-flex items-center gap-2.5 bg-white border border-zinc-200 rounded-lg px-4 py-2 cursor-pointer text-[13px] font-semibold text-zinc-700 shadow-sm hover:shadow-md transition-all duration-150 hover:-translate-y-px"
            >
              <GoogleLogo />
              Sign in with Google
            </button>
            <p className="text-[11.5px] text-subtle mt-2">
              Also connects Google Sheets automatically (shared OAuth).
            </p>
          </IntRow>

          {/* Google Sheets */}
          <IntRow
            icon={<SheetsIcon />}
            name="Google Sheets"
            desc="Read, write, and append rows to your spreadsheets"
            connected={!!sheets?.connected}
            connectedLabel="Connected via Google"
          >
            <p className="text-[12.5px] text-muted">
              Connects automatically when you sign in with Google above.
            </p>
          </IntRow>

          {/* Slack */}
          <IntRow
            icon={<SlackIcon />}
            name="Slack"
            desc="Send messages and notifications to your channels"
            connected={!!slack?.connected}
            connectedLabel="Bot token saved"
          >
            <div className="flex flex-col gap-2.5">
              <p className="text-[12.5px] text-muted">
                Create a Slack app, install it to your workspace, then paste your
                Bot Token (<code className="font-mono text-accent-l text-[11px]">xoxb-…</code>) below.
              </p>
              <div className="flex gap-2">
                <input
                  value={slackToken}
                  onChange={e => { setSlackToken(e.target.value); setSlackError("") }}
                  onKeyDown={e => e.key === "Enter" && saveSlack()}
                  placeholder="xoxb-your-bot-token"
                  className="glass-input flex-1 px-3 py-2 text-[12.5px] font-mono"
                />
                <button
                  onClick={saveSlack}
                  disabled={savingSlack || !slackToken.trim()}
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white border-0 transition-all duration-150 whitespace-nowrap"
                  style={{
                    background: "#7b4eb8",
                    cursor: savingSlack || !slackToken.trim() ? "not-allowed" : "pointer",
                    opacity: savingSlack || !slackToken.trim() ? 0.45 : 1,
                  }}
                >
                  {savingSlack ? <><Spinner size={11} /> Saving…</> : "Save"}
                </button>
              </div>
              {slackError && (
                <p className="text-[12px] text-danger">{slackError}</p>
              )}
            </div>
          </IntRow>
        </div>

        {/* Footer */}
        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={onComplete}
            disabled={!allConnected}
            className={`w-full py-3 rounded-xl text-[14px] font-semibold border-0 transition-all duration-150 ${
              allConnected
                ? "btn-gradient text-white cursor-pointer"
                : "text-subtle cursor-not-allowed"
            }`}
            style={!allConnected ? { background: "rgba(255,255,255,0.04)" } : {}}
          >
            Continue to Workflows →
          </button>

          <div className="flex items-center justify-between">
            <span className="text-[12px] text-subtle">
              {allConnected ? "All services connected" : `${connectedCount} / 3 connected`}
            </span>
            <button
              onClick={onComplete}
              className="bg-transparent border-0 text-subtle text-[12px] cursor-pointer hover:text-muted transition-colors underline underline-offset-2 p-0"
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Service logo icons ───────────────────────────────────────────────────────

function GmailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ea4335" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <path d="M2 7l10 8 10-8"/>
    </svg>
  )
}

function SheetsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0f9d58" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="9" x2="9" y2="21"/>
    </svg>
  )
}

function SlackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7b4eb8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 10H5a1 1 0 01-1-1V5a1 1 0 011-1h9a1 1 0 011 1v9l-3-2z" transform="rotate(0)"/>
      <path d="M10 14H19a1 1 0 011 1v4a1 1 0 01-1 1H10a1 1 0 01-1-1v-9l3 3z"/>
    </svg>
  )
}
