"use client"

import { useState } from "react"
import { useIdentity } from "../lib/identity"

/**
 * Shown once on first account creation to walk the user through saving the
 * recovery phrase. "I saved it" marks it as acknowledged; "Later" only
 * dismisses it for this session (it reappears on the next load; the dashboard
 * backup section always shows it).
 */
export function RecoveryPhraseDialog() {
  const { identity, showBackupPrompt, acknowledgeBackup } = useIdentity()
  const [dismissed, setDismissed] = useState(false)

  if (!showBackupPrompt || !identity?.recoveryPhrase || dismissed) return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 32,
          maxWidth: 520,
          width: "100%",
          boxShadow: "var(--shadow-hover)",
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>
          🪙 Your recovery phrase
        </h2>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
          These 12 words are <b style={{ color: "var(--fg)" }}>your wallet and your account</b>.
          Write them down and keep them somewhere safe — they are the only backup
          of your funds. Restore the same account on any device (or after clearing
          browser data) by entering this phrase; your balance is regenerated
          automatically, you do not need to remember anything else. Anyone who
          has the phrase can move your funds, so <b style={{ color: "var(--red)" }}>never share it</b>.
        </p>
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "16px 20px",
            fontFamily: "var(--font-mono)",
            fontSize: 15,
            lineHeight: 1.9,
            userSelect: "all",
            marginBottom: 20,
          }}
        >
          {identity.recoveryPhrase}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--fg)",
            }}
          >
            Later
          </button>
          <button type="button" onClick={acknowledgeBackup}>
            I saved it
          </button>
        </div>
      </div>
    </div>
  )
}
