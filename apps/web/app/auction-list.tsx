import type { Auction } from "@cashu-auction/shared"
import { AuctionCard } from "./auction-card"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api"

export async function AuctionList() {
  const res = await fetch(`${API_BASE}/auctions`, { cache: "no-store" })
  if (!res.ok) {
    return <p style={{ color: "var(--muted)", fontSize: 14 }}>Could not load auctions.</p>
  }

  const all: Auction[] = await res.json()
  const active = all.filter((a) => a.state === "ACTIVE" || a.state === "EXTENDED")
  const endingSoon = active.filter((a) => a.end_time - Date.now() < 3600000)
  const featured = active.slice(0, 4)

  if (all.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>
        No auctions yet. <a href="/create">Create the first one</a>.
      </div>
    )
  }

  return (
    <div>
      {/* Categories */}
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap",
        paddingBottom: 40, borderBottom: "1px solid var(--border)", marginBottom: 40
      }}>
        {["All", "Art", "Collectibles", "Digital", "Hardware", "Books"].map((cat) => (
          <span key={cat} style={{
            border: "1px solid var(--border)", borderRadius: 100,
            padding: "6px 16px", fontSize: 14, color: "var(--muted)",
            background: "var(--surface)", cursor: "pointer",
          }}>
            {cat}
          </span>
        ))}
      </div>

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
