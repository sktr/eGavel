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
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <a
        href={`https://nostr.at/${naddr}`}
        target="_blank"
        rel="noopener"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 500,
          color: "#fff",
          background: "#8b5cf6",
          borderRadius: 100,
          padding: "6px 14px",
          textDecoration: "none",
        }}
      >
        <span className="material-icons" style={{ fontSize: 14 }}>open_in_new</span>
        View on Nostr
      </a>
      <button
        onClick={onCopy}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--fg)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 100,
          padding: "6px 14px",
          cursor: "pointer",
          fontWeight: 500,
        }}
      >
        <span className="material-icons" style={{ fontSize: 14 }}>{copied ? "check" : "content_copy"}</span>
        {copied ? "Copied" : "Copy naddr"}
      </button>
    </div>
  )
}
