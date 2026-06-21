import type { Auction, Bid } from "@cashu-auction/shared"
import { DetailBidPanel } from "./detail-bid-panel"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api"

function shortId(s: string) {
  if (s.length <= 16) return s
  return s.slice(0, 8) + "..." + s.slice(-6)
}

async function fetchAuction(id: string): Promise<Auction | null> {
  const res = await fetch(`${API_BASE}/auctions/${id}`, { cache: "no-store" })
  if (!res.ok) return null
  return res.json() as Promise<Auction>
}

async function fetchBids(id: string): Promise<Bid[]> {
  const res = await fetch(`${API_BASE}/auctions/${id}/bids`, { cache: "no-store" })
  if (!res.ok) return []
  return res.json() as Promise<Bid[]>
}

export default async function AuctionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [auction, bids] = await Promise.all([fetchAuction(id), fetchBids(id)])
  if (!auction) return <p>auction not found</p>

  const isOpen = auction.state === "ACTIVE" || auction.state === "EXTENDED"

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
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 28,
          padding: "20px 0 48px",
        }}
      >
        {/* ===== LEFT COLUMN: Gallery ===== */}
        <div>
          {/* Main image */}
          <div
            style={{
              aspectRatio: "4 / 3",
              background: "var(--placeholder)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: 14,
              marginBottom: 8,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <span className="material-icons" style={{ fontSize: 40 }}>image</span>
            {isOpen && (
              <span
                style={{
                  position: "absolute",
                  top: 16,
                  left: 16,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  borderRadius: 999,
                  font: "600 12px/1.3 -apple-system, sans-serif",
                  letterSpacing: "0.02em",
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                }}
              >
                <span className="material-icons" style={{ fontSize: 14 }}>local_fire_department</span> {auction.state === "EXTENDED" ? "Extended" : "Active"}
              </span>
            )}
          </div>

          {/* Thumbnails row */}
          <div style={{ display: "flex", gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  width: 72,
                  height: 56,
                  background: "var(--placeholder)",
                  border: i === 0
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--muted)",
                  fontSize: 10,
                  cursor: "pointer",
                  boxSizing: "border-box",
                }}
              >
                [ {i + 1} ]
              </div>
            ))}
          </div>
        </div>

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
          </div>

          {/* Bid panel */}
          <DetailBidPanel auction={auction} bids={bids} serverNpub={""} />

          {/* Bid History */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              marginTop: 24,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 16px",
                background: "var(--surface)",
                fontSize: 13,
                fontWeight: 600,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span>Bid History ({bids.length})</span>
              <a
                href="#"
                style={{
                  color: "var(--accent)",
                  fontSize: 12,
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                View all <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle" }}>arrow_forward</span>
              </a>
            </div>

            {/* Rows */}
            {bids.length === 0 ? (
              <div
                style={{
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "var(--muted)",
                }}
              >
                No bids yet.
              </div>
            ) : (
              bids.map((b: Bid) => (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 16px",
                    fontSize: 13,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ color: "var(--accent)", fontWeight: 500 }}>
                    {shortId(b.bidder_npub)}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {b.amount.toLocaleString()} sats
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    {new Date(b.received_at).toLocaleString("ja-JP", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
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

        {/* ===== BELOW THE GRID: Similar Items (placeholder) ===== */}
        <div style={{ gridColumn: "1 / -1" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 24,
              paddingTop: 24,
              borderTop: "1px solid var(--border)",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              Similar Items
            </h2>
            <a
              href="/auctions"
              style={{ color: "var(--accent)", fontSize: 14, textDecoration: "none" }}
            >
              View more <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle" }}>arrow_forward</span>
            </a>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 24,
            }}
          >
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    aspectRatio: "4 / 3",
                    background: "var(--placeholder)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--muted)",
                    fontSize: 12,
                  }}
                >
                  [ Item Image ]
                </div>
                <div style={{ padding: 16 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      marginBottom: 4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    Item {i}
                  </div>
                  <div
                    style={{
                      color: "var(--muted)",
                      fontSize: 12,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>— sats</span>
                    <span>—</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
