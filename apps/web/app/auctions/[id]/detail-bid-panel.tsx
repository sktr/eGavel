"use client"

import { useState, useEffect } from "react"
import type { Auction, PublicBid } from "@egavel/shared"
import { BidForm } from "./bid-form"
import { useWatchlist } from "../../../lib/watchlist"
import { useIdentity } from "../../../lib/identity"

function formatTimeRemaining(endTime: number): { text: string; urgent: boolean } {
  const diff = endTime - Date.now()
  if (diff <= 0) return { text: "ended", urgent: false }
  const minsTotal = Math.ceil(diff / 60000)
  if (minsTotal < 60) return { text: `${minsTotal}m`, urgent: true }
  const hours = Math.floor(minsTotal / 60)
  const mins = minsTotal % 60
  if (hours < 24) return { text: `${hours}h ${mins}m`, urgent: false }
  const days = Math.floor(hours / 24)
  return { text: `${days}d ${hours % 24}h`, urgent: false }
}

function formatEndDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function DetailBidPanel({
  auction,
  bids,
  serverNpub,
}: {
  auction: Auction
  bids: PublicBid[]
  serverNpub: string
}) {
  const { identity } = useIdentity()
  const isOpen = auction.state === "ACTIVE" || auction.state === "EXTENDED"
  // Proxy bidding: the standing price is the leader's current_amount (2nd max + increment).
  const highestBid = bids.length > 0 ? bids[0]!.current_amount : auction.start_price
  const minBid = auction.start_price
  const amHighest = bids.length > 0 && identity !== null && bids[0]!.bidder_npub === identity.pubkey

  const [buyNow, setBuyNow] = useState(false)
  const buyNowAvailable =
    isOpen &&
    auction.buy_now_price !== null &&
    auction.buy_now_price > 0 &&
    (bids.length === 0 || auction.buy_now_price > bids[0]!.current_amount)

  const { watching, toggle } = useWatchlist()
  const isWatching = watching(auction.id)

  // Live-updating timer
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!isOpen) return
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [isOpen])
  const timeDisplay = formatTimeRemaining(auction.end_time)

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
      }}
    >
      {/* Current highest bid */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          Current Bid
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--fg)",
          }}
        >
          {highestBid.toLocaleString()}{" "}
          <span style={{ fontSize: 16, fontWeight: 400, color: "var(--muted)" }}>
            sats
          </span>
        </span>
        {amHighest && isOpen && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            <span className="material-icons" style={{ fontSize: 13 }}>stars</span>
            You are the highest bidder
          </span>
        )}
      </div>

      {/* Timer */}
      {isOpen && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 14,
            color: "var(--muted)",
            marginBottom: 16,
          }}
        >
          <span className="material-icons" style={{ fontSize: 16, lineHeight: 1 }}>timer</span>
        <span>
           <strong
              style={{
                color: timeDisplay.urgent ? "var(--red)" : "var(--fg)",
                fontWeight: timeDisplay.urgent ? 700 : 600,
              }}
            >
              {timeDisplay.text}
            </strong>
          </span>
          <span style={{ fontSize: 12 }}>
            {formatEndDate(auction.end_time)}
          </span>
        </div>
      )}

      {/* Buy Now */}
      {buyNowAvailable && (
        <button
          type="button"
          onClick={() => setBuyNow(true)}
          style={{
            width: "100%",
            border: "none",
            borderRadius: "var(--radius)",
            background: "var(--accent)",
            color: "#fff",
            padding: "12px 24px",
            fontSize: 15,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            marginBottom: 8,
          }}
        >
          Buy Now — {auction.buy_now_price!.toLocaleString()} sats
        </button>
      )}

      {/* Bid form */}
      <BidForm
        auction={auction}
        serverNpub={serverNpub}
        buyNowPrice={buyNow ? auction.buy_now_price : undefined}
      />

      {/* Bid note */}
      <div
        style={{
          fontSize: 13,
          color: "var(--muted)",
          marginTop: 8,
        }}
      >
        <strong style={{ color: "var(--fg)" }}>
          {minBid.toLocaleString()}
        </strong>{" "}
        sats minimum bid
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          Bids sent before the end time are accepted until {`end + 30s`} (grace). Bids in
          the last 5 minutes extend the auction by 5 minutes.
        </p>
      </div>

      {/* Outline buttons */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 14,
        }}
      >
        <button
          type="button"
          onClick={() => toggle(auction.id)}
          style={{
            flex: 1,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: isWatching ? "var(--accent-soft)" : "var(--surface)",
            color: "var(--fg)",
            padding: "8px 16px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
            lineHeight: 1.4,
          }}
        >
          {isWatching ? "♥ Watching" : "♡ Add to Watchlist"}
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: "var(--surface)",
            color: "var(--fg)",
            padding: "8px 16px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
            lineHeight: 1.4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--border)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--surface)"
          }}
        >
          <span className="material-icons" style={{ fontSize: 16, verticalAlign: "text-bottom" }}>ios_share</span> Share
        </button>
      </div>
    </div>
  )
}
