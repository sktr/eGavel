export default function HowItWorksPage() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1.5rem 4rem" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32, fontSize: 13, color: "var(--muted)" }}>
        <a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>Home</a>
        <span style={{ opacity: 0.4 }}>/</span>
        <span>How it Works</span>
      </div>

      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(28px,4vw,40px)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        How eGavel Works
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 16, marginBottom: 48, maxWidth: 560, lineHeight: 1.6 }}>
        Non-custodial auctions on Cashu e-cash. Bids are locked with a
        2-of-3 P2PK lock, and settlement is automatic.
      </p>

      {/* Step cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {steps.map((step, i) => (
          <div
            key={i}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "24px 28px",
              display: "flex",
              gap: 20,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "var(--accent-soft)",
                display: "grid", placeItems: "center",
                fontFamily: "var(--font-mono)",
                fontWeight: 700, fontSize: 18,
                color: "var(--accent)", flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>
                {step.title}
              </h2>
              <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 0 }}>
                {step.description}
              </p>
              {step.detail && (
                <div
                  style={{
                    marginTop: 12, padding: "12px 16px",
                    background: "var(--bg)", borderRadius: "var(--radius-sm)",
                    color: "var(--fg)", lineHeight: 1.6,
                    fontFamily: "var(--font-mono)", fontSize: 12,
                  }}
                >
                  {step.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tech section */}
      <div
        style={{
          marginTop: 40,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: "24px 28px",
        }}
      >
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 16 }}>
          Technology
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            { title: "Cashu", desc: "An ecash protocol that enables instant, private payments. Proofs are blinded signatures that can be swapped at mints." },
            { title: "P2PK (2-of-3)", desc: "Pay-to-Public-Key locks each bid proof to the seller, the auction server, AND the bidder (2-of-3). No single party can spend bid funds — the seller claims with the server's co-signature, and outbid bidders refund with the server's co-signature." },
            { title: "Proxy bidding", desc: "The bid amount is a maximum. The engine bids just enough to stay in the lead (second-highest max + the minimum increment), and the winner pays only the standing price. The excess over the standing price is returned to the winner after the sale." },
            { title: "Mint", desc: "The Cashu mint holds the actual ecash. The auction server never holds user funds — it only co-signs P2PK unlocks, so it can never move money alone." },
          ].map((tech) => (
            <div key={tech.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 14, fontFamily: "var(--font-mono)", minWidth: 70 }}>
                {tech.title}
              </span>
              <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                {tech.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer links */}
      <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 48 }}>
        <a href="/create" style={{ color: "var(--accent)", textDecoration: "none" }}>Create your first auction</a>
        {" · "}
        <a href="/" style={{ color: "var(--accent)", textDecoration: "none" }}>Browse auctions</a>
      </p>
    </div>
  )
}

const steps = [
  {
    title: "Create an Auction",
    description: "Describe your item, set a starting price and duration. The listing is created directly on the auction server. No deposit, no registration — your account is your key.",
    detail: "POST /api/auctions · Account = 12-word recovery phrase (BIP-39)",
  },
  {
    title: "Bidders Place Bids",
    description:
      "Bidders enter their MAXIMUM bid. The engine bids just enough to stay in the lead — the second-highest max plus the minimum increment. Each bid locks its full max as a 2-of-3 P2PK proof (seller + server + bidder).",
    detail: "2-of-3 lock: seller + server + bidder keys · n_sigs: 2 · Locktime: end_time + 24h · Refund: bidder",
  },
  {
    title: "Auction Extends (Anti-Sniping)",
    description: "If a bid arrives in the last 5 minutes, the auction auto-extends by 5 more minutes. This prevents last-second sniping and gives other bidders time to respond.",
    detail: "Extension: +5 min · Trigger: bid within last 5 min of end_time",
  },
  {
    title: "Settlement",
    description:
      "When the auction ends, bids arriving within a 30-second grace window are still accepted. The highest bidder wins at the standing price once the grace window closes.",
    detail:
      "State: ACTIVE → EXTENDED → SETTLED · Grace: end + 30s · Winner: standing price ≥ reserve",
  },
  {
    title: "Claim & Change",
    description:
      "The seller claims the winning bid: the server splits the locked proofs into the seller's share, the operator fee, and any change (max − standing price) back to the winner. Outbid bidders get an instant refund via bidder + server co-signature.",
    detail:
      "2-of-3: seller + server co-sign the claim · fee: AUCTION_FEE_BPS (5%) · change: returned to the winner",
  },
]
