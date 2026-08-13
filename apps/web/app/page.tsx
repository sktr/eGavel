import { AuctionList } from "./auction-list";

export default function Home() {
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* Hero */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
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
            Peer-to-peer auctions
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
            Bid with sats, settle instantly. No account, no custody — your keys, your coins.
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
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            aspectRatio: "16/10",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            fontSize: 14,
          }}
        >
          [ Featured Auction ]
        </div>
      </section>

      <AuctionList />
    </main>
  );
}
