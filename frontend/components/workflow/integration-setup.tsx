"use client"

import { useState, useEffect, useCallback } from "react"
import type { ReactNode } from "react"
import type { IntegrationStatus } from "@/lib/types"
import { C } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import * as api from "@/lib/api"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// ── Card ─────────────────────────────────────────────────────────────────────

function IntegrationCard({
  abbr, color, name, desc, connected, connectedLabel, children,
}: {
  abbr: string; color: string; name: string; desc: string
  connected: boolean; connectedLabel: string
  children?: ReactNode
}) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${connected ? color + "55" : C.border}`,
      borderRadius: 14,
      padding: "16px 18px",
      transition: "border-color 0.15s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 11,
          background: color + "18", border: `1px solid ${color}30`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 800, color, flexShrink: 0,
        }}>
          {abbr}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{name}</span>
            {connected && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: C.success,
                background: C.success + "18", border: `1px solid ${C.success}33`,
                borderRadius: 99, padding: "2px 9px", letterSpacing: "0.04em",
              }}>
                ✓ {connectedLabel}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.55 }}>{desc}</div>

          {/* Action area — only shown when not yet connected */}
          {!connected && children && (
            <div style={{ marginTop: 14 }}>{children}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Setup screen ──────────────────────────────────────────────────────────────

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

    // Receive message from the Google OAuth popup when it completes
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

  // Open Google OAuth in a popup; also poll the popup for close as a fallback
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
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: C.canvas, color: C.muted, gap: 10, fontSize: 13,
      }}>
        <Spinner /> Checking integrations…
      </div>
    )
  }

  return (
    <div style={{
      minHeight: "100vh", background: C.canvas,
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "40px 24px",
    }}>

      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: "linear-gradient(135deg, #6d28d9, #8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "white", fontWeight: 900, fontSize: 20,
        }}>F</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: C.text }}>FlowForge</div>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.12em" }}>AI AUTOMATION</div>
        </div>
      </div>

      {/* Heading */}
      <div style={{ textAlign: "center", marginBottom: 32, maxWidth: 480 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: "0 0 10px" }}>
          Connect Your Integrations
        </h1>
        <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.65 }}>
          Link your services below. FlowForge uses these to execute each step of your
          automated workflows.
        </p>
      </div>

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 520 }}>

        {/* ── Gmail ─────────────────────────────────────────────────── */}
        <IntegrationCard
          abbr="GM"
          color="#ea4335"
          name="Gmail"
          desc="Read, search, and send emails from your inbox"
          connected={!!gmail?.connected}
          connectedLabel="Connected"
        >
          <button
            onClick={connectGoogle}
            style={{
              display: "inline-flex", alignItems: "center", gap: 9,
              background: "white", border: `1px solid ${C.border2}`,
              borderRadius: 8, padding: "8px 16px", cursor: "pointer",
              fontSize: 13, fontWeight: 600, color: "#3c4043",
              boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
            }}
          >
            <GoogleLogo />
            Sign in with Google
          </button>
          <p style={{ fontSize: 11, color: C.subtle, margin: "8px 0 0", lineHeight: 1.5 }}>
            This also connects Google Sheets automatically (shared OAuth).
          </p>
        </IntegrationCard>

        {/* ── Google Sheets ──────────────────────────────────────────── */}
        <IntegrationCard
          abbr="SH"
          color="#0f9d58"
          name="Google Sheets"
          desc="Read, write, and append rows to your spreadsheets"
          connected={!!sheets?.connected}
          connectedLabel="Connected via Google"
        >
          <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.55 }}>
            Connects automatically when you sign in with Google above.
          </p>
        </IntegrationCard>

        {/* ── Slack ─────────────────────────────────────────────────── */}
        <IntegrationCard
          abbr="SL"
          color="#7b4eb8"
          name="Slack"
          desc="Send messages and notifications to channels"
          connected={!!slack?.connected}
          connectedLabel="Bot token saved"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 11, color: C.muted, margin: 0, lineHeight: 1.55 }}>
              Create a Slack app, install it to your workspace, and paste the
              Bot Token (<code style={{ fontFamily: "monospace" }}>xoxb-…</code>) below.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={slackToken}
                onChange={e => { setSlackToken(e.target.value); setSlackError("") }}
                onKeyDown={e => e.key === "Enter" && saveSlack()}
                placeholder="xoxb-your-bot-token"
                style={{
                  flex: 1, background: C.canvas, border: `1px solid ${C.border2}`,
                  borderRadius: 8, padding: "7px 12px", fontSize: 12, color: C.text,
                  fontFamily: "ui-monospace, 'Cascadia Code', monospace", outline: "none",
                }}
              />
              <button
                onClick={saveSlack}
                disabled={savingSlack || !slackToken.trim()}
                style={{
                  background: "#7b4eb8", color: "white", border: "none",
                  borderRadius: 8, padding: "7px 18px", fontSize: 12,
                  fontWeight: 600, cursor: savingSlack || !slackToken.trim() ? "not-allowed" : "pointer",
                  opacity: savingSlack || !slackToken.trim() ? 0.5 : 1,
                  display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {savingSlack ? <><Spinner size={11} /> Saving…</> : "Save Token"}
              </button>
            </div>
            {slackError && (
              <div style={{ fontSize: 11, color: C.danger, lineHeight: 1.45 }}>{slackError}</div>
            )}
          </div>
        </IntegrationCard>
      </div>

      {/* Footer actions */}
      <div style={{ marginTop: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <button
          onClick={onComplete}
          disabled={!allConnected}
          style={{
            background: allConnected
              ? "linear-gradient(135deg, #6d28d9, #8b5cf6)"
              : C.border,
            color: allConnected ? "white" : C.subtle,
            border: "none", borderRadius: 12, padding: "12px 36px",
            fontSize: 14, fontWeight: 600,
            cursor: allConnected ? "pointer" : "not-allowed",
            transition: "all 0.15s",
          }}
        >
          Continue to Workflows →
        </button>
        <div style={{ fontSize: 11, color: C.subtle }}>
          {allConnected
            ? "All integrations connected — you're ready!"
            : `${statuses.filter(s => s.connected).length} / 3 connected`}
        </div>
        <button
          onClick={onComplete}
          style={{
            background: "none", border: "none", color: C.subtle,
            fontSize: 11, cursor: "pointer", textDecoration: "underline",
            padding: 0,
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}

// ── Google logo SVG ───────────────────────────────────────────────────────────

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}
