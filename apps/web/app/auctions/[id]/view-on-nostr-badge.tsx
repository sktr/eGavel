"use client"

import { useState } from "react"

export function ViewOnNostrBadge({ naddr }: { naddr: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(naddr)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
      <a
        href={`https://nostr.at/${naddr}`}
        target="_blank"
        rel="noopener"
        style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}
      >
        View on Nostr
      </a>
      <button
        onClick={onCopy}
        style={{
          fontSize: 12,
          color: "var(--muted)",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "2px 6px",
          cursor: "pointer",
        }}
      >
        {copied ? "Copied" : "Copy naddr"}
      </button>
    </div>
  )
}
