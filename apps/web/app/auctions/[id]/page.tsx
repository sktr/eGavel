import type { Auction, PublicBid } from "@egavel/shared"
import { LiveBids } from "./live-bids"
import { Checkout } from "./checkout"
import { Gallery } from "./gallery"

const API_BASE = process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api"

function shortId(s: string) {
  if (s.length <= 16) return s
  return s.slice(0, 8) + "..." + s.slice(-6)
}

async function fetchAuction(id: string): Promise<Auction | null> {
  const res = await fetch(`${API_BASE}/auctions/${id}`, { cache: "no-store" })
  if (!res.ok) return null
  return res.json() as Promise<Auction>
}

async function fetchBids(id: string): Promise<PublicBid[]> {
  const res = await fetch(`${API_BASE}/auctions/${id}/bids`, { cache: "no-store" })
  if (!res.ok) return []
  return res.json() as Promise<PublicBid[]>
}

export default async function AuctionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [auction, bids] = await Promise.all([fetchAuction(id), fetchBids(id)])
  if (!auction) return <p>auction not found</p>

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* Breadcrumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "20px 0 4px",
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        <a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>
          Home
        </a>
        <span style={{ color: "var(--muted)", fontSize: 14, opacity: 0.6 }}>/</span>
        <span style={{ color: "var(--fg)" }}>{auction.item}</span>
      </div>

      {/* Detail grid — 2 columns */}
      <div
        className="resp-grid-2col"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 28,
          padding: "20px 0 48px",
        }}
      >
        {/* ===== LEFT COLUMN: Gallery ===== */}
        <Gallery auction={auction} />

        {/* ===== RIGHT COLUMN: Info + Bid ===== */}
        <div>
          {/* Item title */}
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(22px, 2.5vw, 28px)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              marginBottom: 8,
              lineHeight: 1.2,
            }}
          >
            {auction.item}
          </h1>

          {/* Item meta */}
          <div
            style={{
              display: "flex",
              gap: 16,
              color: "var(--muted)",
              fontSize: 13,
              marginBottom: 24,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="material-icons" style={{ fontSize: 16, verticalAlign: "text-bottom" }}>inventory_2</span> {auction.state}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="material-icons" style={{ fontSize: 16, verticalAlign: "text-bottom" }}>visibility</span> {bids.length} bids
            </span>
            {auction.mint_url === "" && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Legacy listing — bidding disabled</span>
            )}
          </div>

          {/* Live bid panel + history (polls the server) */}
          <LiveBids auction={auction} bids={bids} serverNpub={""} />
        </div>

        {/* ===== BELOW THE GRID: Description ===== */}
        {auction.description && (
          <div style={{ gridColumn: "1 / -1", marginTop: 0 }}>
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 17,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                marginBottom: 16,
              }}
            >
               Description
            </h3>
            <p
              style={{
                color: "var(--muted)",
                fontSize: 14,
                lineHeight: 1.8,
                marginBottom: 24,
              }}
            >
              {auction.description}
            </p>
          </div>
        )}

        {/* ===== BELOW THE GRID: Details Table ===== */}
        <div style={{ gridColumn: "1 / -1" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
              marginBottom: 40,
            }}
          >
            <tbody>
              <tr>
                <th
                  style={{
                    width: 120,
                    textAlign: "left",
                    color: "var(--muted)",
                    fontWeight: 400,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  Start Price
                </th>
                <td
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {auction.start_price.toLocaleString()} sats
                </td>
              </tr>
              <tr>
                <th
                  style={{
                    width: 120,
                    textAlign: "left",
                    color: "var(--muted)",
                    fontWeight: 400,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  Status
                </th>
                <td
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {auction.state}
                </td>
              </tr>
              <tr>
                <th
                  style={{
                    width: 120,
                    textAlign: "left",
                    color: "var(--muted)",
                    fontWeight: 400,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  Start Date
                </th>
                <td
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {new Date(auction.start_time).toLocaleString("ja-JP")}
                </td>
              </tr>
              <tr>
                <th
                  style={{
                    width: 120,
                    textAlign: "left",
                    color: "var(--muted)",
                    fontWeight: 400,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  End Date
                </th>
                <td
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {new Date(auction.end_time).toLocaleString("ja-JP")}
                </td>
              </tr>
              <tr>
                <th
                  style={{
                    width: 120,
                    textAlign: "left",
                    color: "var(--muted)",
                    fontWeight: 400,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  Seller
                </th>
                <td
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                >
                  {shortId(auction.seller_pubkey)}
                </td>
              </tr>
              {auction.winner_npub && (
                <tr>
                  <th
                    style={{
                      width: 120,
                      textAlign: "left",
                      color: "var(--muted)",
                      fontWeight: 400,
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    Winner
                  </th>
                  <td
                    style={{
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                  >
                    {shortId(auction.winner_npub)}
                  </td>
                </tr>
              )}
              {auction.winning_amount != null && (
                <tr>
                  <th
                    style={{
                      width: 120,
                      textAlign: "left",
                      color: "var(--muted)",
                      fontWeight: 400,
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    Winning Amount
                  </th>
                  <td
                    style={{
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 600,
                    }}
                  >
                    {auction.winning_amount.toLocaleString()} sats
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ===== BELOW THE GRID: Seller Card ===== */}
        <div style={{ gridColumn: "1 / -1" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: 16,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              marginBottom: 40,
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "var(--placeholder)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 14,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {auction.item.charAt(0)}
            </div>
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                   Seller
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {shortId(auction.seller_pubkey)}
              </div>
            </div>
          </div>
        </div>

        {/* ===== BELOW THE GRID: Settlement (for SETTLED auctions) ===== */}
        {auction.state === "SETTLED" && (
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
              padding: "24px 28px",
              gridColumn: "1 / -1",
              marginBottom: 24,
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 18,
                marginBottom: 12,
              }}
            >
              Settlement Info
            </h2>
            {auction.winner_npub ? (
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: 22,
                    color: "var(--accent2)",
                  }}
                >
                  {auction.winning_amount?.toLocaleString()} sats
                </div>
                <code
                  style={{
                    marginTop: 4,
                    display: "inline-block",
                    fontSize: 13,
                  }}
                >
                  {shortId(auction.winner_npub)}
                </code>
              </div>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>
                Reserve price not met — no winner
              </p>
            )}
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 15,
                marginTop: 16,
                marginBottom: 8,
              }}
            >
              Contact
            </h3>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
                               Seller: <code>{shortId(auction.seller_pubkey)}</code>
              {auction.winner_npub && (
                <> · Winner: <code>{shortId(auction.winner_npub)}</code></>
              )}
            </div>
          </div>
        )}

        {/* ===== BELOW THE GRID: Winner Checkout ===== */}
        <div style={{ gridColumn: "1 / -1" }}>
          <Checkout auctionId={auction.id} winnerNpub={auction.winner_npub ?? ""} />
        </div>
      </div>
    </div>
  )
}
