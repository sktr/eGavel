"use client"

import type { Auction } from "@cashu-auction/shared"

function timeLeft(ms: number): string {
  const diff = ms - Date.now()
  if (diff <= 0) return "ended"
  const mins = Math.ceil(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return `${hours}h ${rem}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function AuctionCard({ a }: { a: Auction }) {
  const isOpen = a.state === "ACTIVE" || a.state === "EXTENDED"
  return (
    <a href={`/auctions/${a.id}`} style={{
      display: "block", background: "var(--surface)",
      border: "1px solid var(--border)", borderRadius: "var(--radius)",
      overflow: "hidden", textDecoration: "none", color: "inherit",
      transition: "box-shadow .2s",
    }}>
      <div style={{
        aspectRatio: "4/3", background: "var(--placeholder)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--muted)", fontSize: 13,
      }}>
        [ {a.item} ]
      </div>
      <div style={{ padding: "var(--space-md)" }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {a.item}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--fg)" }}>
            {a.start_price.toLocaleString()} sats
          </span>
          {isOpen && <span>{timeLeft(a.end_time)}</span>}
        </div>
      </div>
    </a>
  )
}
