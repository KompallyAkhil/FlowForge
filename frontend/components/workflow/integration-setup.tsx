"use client"

import { useState, useEffect, useCallback } from "react"
import type { ReactNode } from "react"
import type { IntegrationStatus } from "@/lib/types"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

// ─── Icons ────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
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
  const [statuses, setStatuses]             = useState<IntegrationStatus[]>([])
  const [loading, setLoading]               = useState(true)

  const [googleClientId, setGoogleClientId]         = useState("")
  const [googleClientSecret, setGoogleClientSecret] = useState("")
  const [googleRefreshToken, setGoogleRefreshToken] = useState("")
  const [savingGoogle, setSavingGoogle]             = useState(false)
  const [googleError, setGoogleError]               = useState("")
  const [savingEnv, setSavingEnv]                   = useState(false)

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

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const gmail  = statuses.find(s => s.integration === "gmail")
  const sheets = statuses.find(s => s.integration === "sheets")
  const slack  = statuses.find(s => s.integration === "slack")

  const googleConnected = !!gmail?.connected && !!sheets?.connected
  const allConnected    = googleConnected && !!slack?.connected
  const connectedCount  = statuses.filter(s => s.connected).length

  const saveGoogle = async () => {
    if (!googleClientId.trim() || !googleClientSecret.trim() || !googleRefreshToken.trim()) return
    setSavingGoogle(true); setGoogleError("")
    try {
      await api.saveGoogleCredentials(
        googleClientId.trim(),
        googleClientSecret.trim(),
        googleRefreshToken.trim(),
      )
      setGoogleClientId(""); setGoogleClientSecret(""); setGoogleRefreshToken("")
      await fetchStatus()
    } catch (e) {
      setGoogleError(String(e).replace(/^Error:\s*/, ""))
    } finally {
      setSavingGoogle(false)
    }
  }

  const useEnv = async () => {
    setSavingEnv(true); setGoogleError(""); setSlackError("")
    try {
      await api.useAllEnv()
      await fetchStatus()
    } catch (e) {
      setGoogleError(String(e).replace(/^Error:\s*/, ""))
    } finally {
      setSavingEnv(false)
    }
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
            <div className="flex flex-col gap-2.5">
              <p className="text-[12.5px] text-muted">
                Paste your Google API credentials below. Also connects Google Sheets automatically.
              </p>
              {(["Client ID", "Client Secret", "Refresh Token"] as const).map((label) => {
                const valueMap = {
                  "Client ID":     googleClientId,
                  "Client Secret": googleClientSecret,
                  "Refresh Token": googleRefreshToken,
                }
                const setterMap = {
                  "Client ID":     setGoogleClientId,
                  "Client Secret": setGoogleClientSecret,
                  "Refresh Token": setGoogleRefreshToken,
                }
                return (
                  <input
                    key={label}
                    value={valueMap[label]}
                    onChange={e => { setterMap[label](e.target.value); setGoogleError("") }}
                    onKeyDown={e => e.key === "Enter" && saveGoogle()}
                    placeholder={label}
                    className="glass-input w-full px-3 py-2 text-[12.5px] font-mono"
                  />
                )
              })}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={saveGoogle}
                  disabled={savingGoogle || !googleClientId.trim() || !googleClientSecret.trim() || !googleRefreshToken.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white border-0 transition-all duration-150"
                  style={{
                    background: "#ea4335",
                    cursor: savingGoogle || !googleClientId.trim() || !googleClientSecret.trim() || !googleRefreshToken.trim() ? "not-allowed" : "pointer",
                    opacity: savingGoogle || !googleClientId.trim() || !googleClientSecret.trim() || !googleRefreshToken.trim() ? 0.45 : 1,
                  }}
                >
                  {savingGoogle ? <><Spinner size={11} /> Saving…</> : "Save"}
                </button>

                <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.1)" }} />

                <button
                  onClick={useEnv}
                  disabled={savingEnv}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border-0 transition-all duration-150"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    color: savingEnv ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.55)",
                    cursor: savingEnv ? "not-allowed" : "pointer",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {savingEnv ? <><Spinner size={10} /> Loading…</> : "Use backend .env"}
                </button>
              </div>
              {googleError && <p className="text-[12px] text-danger">{googleError}</p>}
            </div>
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
                Paste your Slack bot token below, or load it from backend .env.
              </p>
              <input
                value={slackToken}
                onChange={e => { setSlackToken(e.target.value); setSlackError("") }}
                onKeyDown={e => e.key === "Enter" && saveSlack()}
                placeholder="xoxb-your-bot-token"
                className="glass-input w-full px-3 py-2 text-[12.5px] font-mono"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={saveSlack}
                  disabled={savingSlack || !slackToken.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white border-0 transition-all duration-150"
                  style={{
                    background: "#7b4eb8",
                    cursor: savingSlack || !slackToken.trim() ? "not-allowed" : "pointer",
                    opacity: savingSlack || !slackToken.trim() ? 0.45 : 1,
                  }}
                >
                  {savingSlack ? <><Spinner size={11} /> Saving…</> : "Save"}
                </button>

                <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.1)" }} />

                <button
                  onClick={useEnv}
                  disabled={savingEnv}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border-0 transition-all duration-150"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    color: savingEnv ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.55)",
                    cursor: savingEnv ? "not-allowed" : "pointer",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {savingEnv ? <><Spinner size={10} /> Loading…</> : "Use backend .env"}
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
