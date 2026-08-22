"use client"

import { useState, useEffect } from "react"
import type { Auction } from "@egavel/shared"
import { AuctionCard } from "./auction-card"
import { CreateAuctionGuard } from "../components/create-auction-guard"
import { apiUrl } from "../lib/api"

/**
 * Live home/listing sections. Polls GET /api/auctions with adaptive backoff
 * (fast while prices change, slow while idle) so a bid placed anywhere is
 * reflected on the homepage within seconds — same pattern as the detail page's
 * live-bids.tsx. Seeded with server-rendered data for instant first paint.
 */
export function LiveAuctionList({ initial }: { initial: Auction[] }) {
  const [all, setAll] = useState(initial)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    let lastJson = ""

    const BACKOFF_LEVELS = [4000, 10_000, 30_000, 60_000]
    let level = 0

    const poll = async () => {
      try {
        const res = await fetch(apiUrl("/auctions"), { cache: "no-store" })
        if (cancelled || !res.ok) return
        const json = await res.text()
        if (json === lastJson) {
          level = Math.min(level + 1, BACKOFF_LEVELS.length - 1)
          return
        }
        lastJson = json
        level = 0 // something changed — poll fast again
        setAll(JSON.parse(json) as Auction[])
      } catch {
        // transient network error — keep the last good data
      } finally {
        if (!cancelled && !document.hidden) restartTimer()
      }
    }

    const restartTimer = () => {
      if (timer) clearInterval(timer)
      timer = setInterval(poll, BACKOFF_LEVELS[level] ?? 60_000)
    }

    // Background tab: stop polling entirely. Resume with an immediate poll
    // when the tab becomes visible again.
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      } else {
        void poll()
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    if (!document.hidden) void poll()
    restartTimer()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  const active = all.filter((a) => a.state === "ACTIVE" || a.state === "EXTENDED")
  const endingSoon = active.filter((a) => a.end_time - Date.now() < 3600000)
  const featured = active.slice(0, 4)

  if (all.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>
        No auctions yet. <CreateAuctionGuard>Create the first one</CreateAuctionGuard>.
      </div>
    )
  }

  return (
    <div>
      {/* Featured */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Featured Auctions
        </h2>
            <a href="/auctions" style={{ fontSize: 14, color: "var(--muted)" }}>All <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle" }}>arrow_forward</span></a>
          </div>
          {featured.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 24 }}>
          {featured.map((a) => <AuctionCard key={a.id} a={a} />)}
        </div>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 40 }}>No active auctions.</p>
      )}

      {/* Ending Soon */}
      <div style={{ marginTop: 40, marginBottom: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Ending Soon
          </h2>
            <a href="/auctions?sort=ending" style={{ fontSize: 14, color: "var(--muted)" }}>All <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle" }}>arrow_forward</span></a>
          </div>
          {endingSoon.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 24 }}>
            {endingSoon.map((a) => <AuctionCard key={a.id} a={a} />)}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No items ending soon.</p>
        )}
      </div>

      {/* Past Auctions */}
      {all.filter(a => a.state === "SETTLED").length > 0 && (
        <div style={{ marginTop: 40, marginBottom: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Past Auctions
            </h2>
            <a href="/auctions?status=settled" style={{ fontSize: 14, color: "var(--muted)" }}>All <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle" }}>arrow_forward</span></a>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 24 }}>
            {all.filter(a => a.state === "SETTLED").slice(0, 4).map((a) => (
              <AuctionCard key={a.id} a={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
