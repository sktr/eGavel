"use client"

import { useEffect, useState, useCallback } from "react"
import { useIdentity } from "../../lib/identity"
import type { Auction, Bid } from "@cashu-auction/shared"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api"

function shortId(s: string) {
  if (s.length <= 16) return s
  return s.slice(0, 8) + "..." + s.slice(-6)
}

function timeLeft(ms: number) {
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

function statusPill(label: string, variant: "active" | "winning" | "outbid" | "won" | "pending") {
  const pal: Record<string, { bg: string; fg: string }> = {
    active: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    winning: { bg: "oklch(92% 0.04 145)", fg: "oklch(40% 0.10 145)" },
    outbid: { bg: "oklch(92% 0.04 30)", fg: "oklch(48% 0.10 30)" },
    won: { bg: "oklch(92% 0.04 145)", fg: "oklch(40% 0.10 145)" },
    pending: { bg: "var(--bg)", fg: "var(--muted)" },
  }
  const c = (pal[variant] ?? pal.pending)!
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        background: c.bg,
        color: c.fg,
      }}
    >
      {label}
    </span>
  )
}

// Thumbnails by item name (deterministic) using Material Icons
function itemThumb(name: string) {
  const icons = ["image", "palette", "description", "smart_toy", "checkroom", "bolt", "diamond", "key", "inventory_2", "music_note", "photo_camera", "watch"]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return <span className="material-icons">{icons[Math.abs(hash) % icons.length]}</span>
}

export default function DashboardPage() {
  const { identity, isLoaded } = useIdentity()
  const [auctions, setAuctions] = useState<Auction[]>([])
  const [bids, setBids] = useState<Bid[]>([])
  const [auctionLookup, setAuctionLookup] = useState<Record<string, Auction>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAuctionById = useCallback(async (id: string): Promise<Auction | null> => {
    try {
      const res = await fetch(`${API_BASE}/auctions/${id}`, { cache: "no-store" })
      if (!res.ok) return null
      return res.json() as Promise<Auction>
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    if (!identity) {
      setError("Identity not available — try refreshing the page.")
      setLoading(false)
      return
    }

    const fetchData = async () => {
      try {
        const [auctionsRes, bidsRes] = await Promise.all([
          fetch(`${API_BASE}/auctions?seller_pubkey=${identity.pubkey}`),
          fetch(`${API_BASE}/bids?bidder_pubkey=${identity.pubkey}`),
        ])

        if (!auctionsRes.ok) throw new Error(`auctions: ${auctionsRes.status}`)
        if (!bidsRes.ok) throw new Error(`bids: ${bidsRes.status}`)

        const fetchedAuctions: Auction[] = await auctionsRes.json()
        const fetchedBids: Bid[] = await bidsRes.json()

        setAuctions(fetchedAuctions)
        setBids(fetchedBids)

        // Build lookup for auctions referenced by bids
        const lookup: Record<string, Auction> = {}
        for (const a of fetchedAuctions) {
          lookup[a.id] = a
        }
        // Fetch any missing auctions from bids
        const missingIds = [...new Set(fetchedBids.map((b) => b.auction_id))].filter(
          (id) => !lookup[id],
        )
        if (missingIds.length > 0) {
          const fetched = await Promise.all(missingIds.map(fetchAuctionById))
          for (const a of fetched) {
            if (a) lookup[a.id] = a
          }
        }
        setAuctionLookup(lookup)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [identity, isLoaded, fetchAuctionById])

  if (!isLoaded || loading) {
    return (
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "4rem 24px",
          textAlign: "center",
          color: "var(--muted)",
        }}
      >
        Loading dashboard…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "4rem 24px" }}>
        <div style={{ padding: "40px 0 32px" }}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "clamp(28px, 4vw, 36px)",
              letterSpacing: "-0.02em",
              marginBottom: 8,
            }}
          >
            Dashboard
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>An error occurred while loading the dashboard.</p>
        </div>
        <p style={{ color: "var(--red)" }}>{error}</p>
      </div>
    )
  }

  // Compute stats
  const activeListings = auctions.filter(
    (a) => a.state === "ACTIVE" || a.state === "EXTENDED",
  )
  const activeBids = bids.filter((b) => {
    const auction = auctionLookup[b.auction_id]
    return auction && (auction.state === "ACTIVE" || auction.state === "EXTENDED")
  })
  const wonAuctions = auctions.filter((a) => a.state === "SETTLED" && a.winner_npub === identity?.pubkey)
  const totalSpent = wonAuctions.reduce((sum, a) => sum + (a.winning_amount ?? 0), 0)

  // Winning bids: bids on auctions where the user is the winner
  const wonBids = bids.filter((b) => {
    const auction = auctionLookup[b.auction_id]
    return auction && auction.state === "SETTLED" && auction.winner_npub === identity?.pubkey
  })

  // Auctions I won but where my bid matches winning amount
  const wonViaBid = wonBids.length > 0
  // Combined claimable items
  const claimable = wonAuctions.length

  // Info for bid cards: determine status
  function bidStatus(b: Bid): { label: string; variant: "winning" | "outbid" | "won" } {
    const auction = auctionLookup[b.auction_id]
    if (!auction) return { label: "Pending", variant: "outbid" }
    if (auction.state === "SETTLED") {
      // Check if this is the winning bid
      if (auction.winner_npub === identity?.pubkey && b.amount === auction.winning_amount) {
        return { label: "Won", variant: "won" }
      }
      return { label: "Ended", variant: "outbid" }
    }
    // Still active — check if it's the current highest
    if (b.status === "verified") {
      return { label: "Winning", variant: "winning" }
    }
    return { label: "Outbid", variant: "outbid" }
  }

  // Generate activity feed items from available data
  const activityItems: Array<{ icon: string; text: string; time: string }> = []
  // Recent bid activities
  for (const b of activeBids.slice(-3).reverse()) {
    const a = auctionLookup[b.auction_id]
    if (a) {
      const st = bidStatus(b)
      activityItems.push({
        icon: "notifications",
        text: `Placed bid on "${a.item}" (${b.amount.toLocaleString()} sats)`,
        time: timeLeft(a.end_time),
      })
    }
  }
  // Won activities
  for (const a of wonAuctions.slice(0, 2)) {
    activityItems.push({
      icon: "emoji_events",
      text: `Won "${a.item}" (${(a.winning_amount ?? 0).toLocaleString()} sats)`,
      time: "Closed",
    })
  }
  // Listed activities
  for (const a of activeListings.slice(0, 2)) {
    activityItems.push({
      icon: "ios_share",
      text: `Listed "${a.item}"`,
      time: timeLeft(a.end_time),
    })
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* ===== Page Header ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 40,
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(22px, 2.5vw, 28px)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Dashboard
        </h1>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          Last login: {new Date().toLocaleString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* ===== Profile Card ===== */}
      <div
        style={{
          display: "flex",
          gap: 24,
          alignItems: "center",
          padding: 24,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          marginBottom: 40,
          flexWrap: "wrap",
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "#f3f4f6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          {identity?.pubkey ? identity.pubkey.charAt(0).toUpperCase() : "?"}
        </div>
        {/* Info */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {identity?.pubkey ? shortId(identity.pubkey) : "User"}
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              fontSize: 13,
              color: "var(--muted)",
              marginTop: 4,
              flexWrap: "wrap",
            }}
          >
            <span>Rating 4.8 (128 reviews)</span>
            <span>Joined: 2024/03/12</span>
          </div>
        </div>
        {/* Stats */}
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {activeBids.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Bidding</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {wonAuctions.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Won</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {activeListings.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Listed</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {auctions.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Watching</div>
          </div>
        </div>
        {/* Edit button */}
        <button
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: "var(--surface)",
            color: "var(--fg)",
            padding: "8px 20px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Edit Profile
        </button>
      </div>

      {/* ===== Tab Navigation ===== */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          marginBottom: 24,
        }}
      >
        {["Bidding", "Won", "Listed", "Watchlist", "Bid History", "Settings"].map(
          (tab) => (
            <div
              key={tab}
              style={{
                padding: "8px 16px",
                fontSize: 14,
                color:
                  tab === "Bidding" ? "var(--accent)" : "var(--muted)",
                borderBottom:
                  tab === "Bidding"
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                fontWeight: tab === "Bidding" ? 500 : 400,
                cursor: "default",
              }}
            >
              {tab}
            </div>
          ),
        )}
      </div>

      {/* ===== Active Bids ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Active Bids
        </h2>
        <a href="#" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>
          View all <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle" }}>arrow_forward</span>
        </a>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0 16px",
          marginBottom: 24,
        }}
      >
        {activeBids.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14, padding: "16px 0" }}>
            No active bids.
            <a href="/" style={{ color: "var(--accent)", marginLeft: 4 }}>
              Browse items
            </a>
          </p>
        )}

        {activeBids.map((b, idx) => {
          const auction = auctionLookup[b.auction_id]
          const st = bidStatus(b)
          return (
            <a
              key={b.id}
              href={`/auctions/${b.auction_id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "56px 1fr auto",
                gap: 16,
                alignItems: "center",
                padding: "8px 0",
                borderBottom:
                  idx < activeBids.length - 1
                    ? "1px solid var(--border)"
                    : "none",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {/* Thumbnail */}
              <div
                style={{
                  width: 56,
                  height: 42,
                  background: st.variant === "winning"
                    ? "oklch(90% 0.06 145)"
                    : st.variant === "outbid"
                      ? "oklch(90% 0.04 30)"
                      : "#f3f4f6",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {itemThumb(auction?.item ?? "item")}
              </div>
              {/* Info */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {auction?.item ?? `Auction ${shortId(b.auction_id)}`}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {statusPill(st.label, st.variant)}
                  {auction && (auction.state === "ACTIVE" || auction.state === "EXTENDED") && (
                    <span>{timeLeft(auction.end_time)}</span>
                  )}
                </div>
              </div>
              {/* Status + Price */}
              <div style={{ textAlign: "right", fontSize: 13 }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    fontSize: 14,
                    color:
                      st.variant === "winning"
                        ? "var(--accent2)"
                        : st.variant === "won"
                          ? "var(--accent2)"
                          : "var(--fg)",
                  }}
                >
                  {b.amount.toLocaleString()} sats
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {st.label === "Winning"
                    ? "Highest Bidder"
                    : st.label === "Outbid"
                      ? "Bidding"
                      : st.label}
                </div>
              </div>
            </a>
          )
        })}

        {/* Settled/won bids (under Active Bids) */}
        {bids.filter((b) => {
          const a = auctionLookup[b.auction_id]
          return a && a.state === "SETTLED"
        }).length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
            {bids
              .filter((b) => {
                const a = auctionLookup[b.auction_id]
                return a && a.state === "SETTLED"
              })
              .map((b, idx, arr) => {
                const auction = auctionLookup[b.auction_id]
                const isWinner =
                  auction?.winner_npub === identity?.pubkey &&
                  b.amount === auction?.winning_amount
                return (
                  <a
                    key={b.id}
                    href={`/auctions/${b.auction_id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "56px 1fr auto",
                      gap: 16,
                      alignItems: "center",
                      padding: "8px 0",
                      borderBottom:
                        idx < arr.length - 1 ? "1px solid var(--border)" : "none",
                      color: "inherit",
                      textDecoration: "none",
                      opacity: isWinner ? 1 : 0.7,
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        height: 42,
                        background: isWinner ? "oklch(92% 0.04 145)" : "#f3f4f6",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        flexShrink: 0,
                      }}
                    >
                      {itemThumb(auction?.item ?? "item")}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {auction?.item ?? `Auction ${shortId(b.auction_id)}`}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginTop: 2,
                        }}
                      >
                        {statusPill(isWinner ? "Won" : "Ended", isWinner ? "won" : "outbid")}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 13 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontWeight: 600,
                          fontSize: 14,
                        }}
                      >
                        {b.amount.toLocaleString()} sats
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {isWinner ? "Winning Price" : "Bid Amount"}
                      </div>
                    </div>
                  </a>
                )
              })}
          </div>
        )}
      </div>

      {/* ===== My Listings ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          My Listings
        </h2>
        <a href="/create" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>
          View all <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle" }}>arrow_forward</span>
        </a>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0 16px",
          marginBottom: 24,
        }}
      >
        {activeListings.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14, padding: "16px 0" }}>
            No active listings.
            <a href="/create" style={{ color: "var(--accent)", marginLeft: 4 }}>
              Create Listing
            </a>
          </p>
        )}

        {activeListings.map((a, idx) => {
          const bidCount = bids.filter((b) => b.auction_id === a.id).length
          return (
            <a
              key={a.id}
              href={`/auctions/${a.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "56px 1fr auto",
                gap: 16,
                alignItems: "center",
                padding: "8px 0",
                borderBottom:
                  idx < activeListings.length - 1
                    ? "1px solid var(--border)"
                    : "none",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 42,
                  background: "#f3f4f6",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {itemThumb(a.item)}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{a.item}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {statusPill("Active", "active")}
                  <span>{timeLeft(a.end_time)}</span>
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 13 }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  {a.start_price.toLocaleString()} sats
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {bidCount} bids
                </div>
              </div>
            </a>
          )
        })}
      </div>

      {/* ===== Watchlist ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Watchlist
        </h2>
        <a href="#" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>
          View all <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle" }}>arrow_forward</span>
        </a>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {wonAuctions.length === 0 && activeListings.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14, gridColumn: "1 / -1" }}>
            No watched items yet.
          </p>
        )}

        {/* Show settled auctions as watchlist cards */}
        {wonAuctions.slice(0, 6).map((a) => (
          <a
            key={a.id}
            href={`/auctions/${a.id}`}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <div
              style={{
                aspectRatio: "4 / 3",
                background: "#f3f4f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 24,
              }}
            >
              {itemThumb(a.item)}
            </div>
            <div style={{ padding: "8px 12px 12px" }}>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginBottom: 4,
                }}
              >
                {a.item}
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--fg)",
                    fontSize: 13,
                  }}
                >
                  {a.winning_amount?.toLocaleString() ?? a.start_price.toLocaleString()} sats
                </span>
                <span>Won</span>
              </div>
            </div>
          </a>
        ))}
        {/* If no won auctions, show active listings */}
        {wonAuctions.length === 0 && activeListings.slice(0, 6).map((a) => (
          <a
            key={a.id}
            href={`/auctions/${a.id}`}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <div
              style={{
                aspectRatio: "4 / 3",
                background: "#f3f4f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 24,
              }}
            >
              {itemThumb(a.item)}
            </div>
            <div style={{ padding: "8px 12px 12px" }}>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginBottom: 4,
                }}
              >
                {a.item}
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--fg)",
                    fontSize: 13,
                  }}
                >
                  {a.start_price.toLocaleString()} sats
                </span>
                <span>{timeLeft(a.end_time)}</span>
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* ===== Recent Activity ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Recent Activity
        </h2>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "4px 16px",
          marginBottom: 24,
        }}
      >
        {activityItems.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14, padding: "12px 0" }}>
            No recent activity.
          </p>
        ) : (
          activityItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                gap: 16,
                padding: "8px 0",
                alignItems: "center",
                borderBottom:
                  idx < activityItems.length - 1
                    ? "1px solid var(--border)"
                    : "none",
                fontSize: 13,
              }}
            >
              <span className="material-icons" style={{ width: 20, textAlign: "center", color: "var(--muted)", fontSize: 16 }}>
                {item.icon}
              </span>
              <span style={{ flex: 1 }}>{item.text}</span>
              <span
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {item.time}
              </span>
            </div>
          ))
        )}
      </div>

      {/* ===== Ready to Claim ===== */}
      {claimable > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              marginBottom: 16,
            }}
          >
            Ready to Claim
          </h2>

          {wonAuctions.map((a) => {
            const winningBid = bids.find(
              (b) => b.auction_id === a.id && b.amount === a.winning_amount,
            )
            const proofData = winningBid?.proof_data ?? null
            let parsedProof: Record<string, string> | null = null
            try {
              if (proofData) parsedProof = JSON.parse(proofData)
            } catch {
              /* ignore */
            }

            return (
              <div
                key={a.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "16px",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <a
                      href={`/auctions/${a.id}`}
                      style={{
                        color: "inherit",
                        fontWeight: 600,
                        fontSize: 14,
                        textDecoration: "none",
                      }}
                    >
                      {a.item}
                    </a>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        marginTop: 2,
                      }}
                    >
                      Winner: {shortId(a.winner_npub ?? "")} —{" "}
                      {a.winning_amount?.toLocaleString()} sats
                    </div>
                  </div>
                  {statusPill("Settled", "won")}
                </div>
                {proofData ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      {parsedProof?.mint_url === "test://local"
                        ? "Test proof — locked to your pubkey"
                        : "Proof locked to your pubkey"}
                    </span>
                    <button
                      style={{
                        fontSize: 12,
                        padding: "6px 14px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        background: "var(--surface)",
                        color: "var(--fg)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        flexShrink: 0,
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(proofData)
                      }}
                    >
                      Copy Proof
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>
                    No proof data.
                  </p>
                )}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
