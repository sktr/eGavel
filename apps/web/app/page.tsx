import type { Auction } from "@egavel/shared"
import { AuctionList } from "./auction-list"
import { ItemPlaceholder } from "../components/item-placeholder"

const API_BASE = (process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "")

export default async function Home() {
  let featured: Auction | null = null
  try {
    const res = await fetch(`${API_BASE}/api/auctions?filter=active`, { cache: "no-store" })
    if (res.ok) {
      const active = (await res.json()) as Auction[]
      featured =
        active
          .filter((a) => a.state === "ACTIVE" || a.state === "EXTENDED")
          .sort((a, b) => a.end_time - b.end_time)[0] ?? null
    }
  } catch {
    // hero simply stays hidden
  }
  const featuredImage = featured?.images?.[0]

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* Hero */}
      <section
        className="resp-grid-2col"
        style={{
          display: "grid",
          gridTemplateColumns: featured ? "1fr 1fr" : "1fr",
          gap: 40,
          padding: "64px 0 40px",
          alignItems: "center",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(28px,4vw,44px)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              marginBottom: 16,
            }}
          >
            Non-custodial auctions
            <br />
            on Cashu e-cash
          </h1>
          <p
            style={{
              color: "var(--muted)",
              fontSize: 16,
              marginBottom: 24,
              maxWidth: 440,
              lineHeight: 1.5,
            }}
          >
            Bid with sats, settle instantly. No custody — your keys, your coins. Funds are locked 2-of-3, so no single party can move them.
          </p>
          <a
            href="/create"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "10px 20px",
              fontSize: 15,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            Create Auction{" "}
            <span className="material-icons" style={{ fontSize: 16, verticalAlign: "text-bottom" }}>
              arrow_forward
            </span>
          </a>
        </div>
        {featured && (
          <a
            href={`/auctions/${featured.id}`}
            style={{
              display: "block",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              overflow: "hidden",
              textDecoration: "none",
              color: "inherit",
              transition: "box-shadow .2s",
            }}
          >
            <div
              style={{
                aspectRatio: "16/10",
                background: "var(--placeholder)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 14,
                position: "relative",
              }}
            >
              {featuredImage ? (
                <img
                  src={featuredImage}
                  alt={featured.item}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <ItemPlaceholder category={featured.category} name={featured.item} size={48} />
              )}
            </div>
            <div style={{ padding: "10px 14px", fontWeight: 600, fontSize: 14 }}>
              {featured.item}
            </div>
          </a>
        )}
      </section>

      <AuctionList />
    </main>
  )
}
