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
        How Cashu Auction Works
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 16, marginBottom: 48, maxWidth: 560, lineHeight: 1.6 }}>
        Peer-to-peer auctions without custody. Bids are locked with Cashu e-cash, 
        settlement is automatic, and everything runs on Nostr relays.
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
            { title: "Nostr", desc: "A decentralized protocol for event distribution. Auctions and bids are published as signed Nostr events." },
            { title: "P2PK", desc: "Pay-to-Public-Key locks the bid proof to the seller's pubkey. The seller can claim it after the auction ends and locktime passes." },
            { title: "NIP-59", desc: "Gift Wrap encrypts bid payloads so only the server can decrypt them. Bid amounts and bidder identities stay private until settlement." },
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
    description: "Describe your item, set a starting price and duration. A Nostr event (kind:39000) is published to relays. No deposit, no registration — just your Nostr key.",
    detail: "Kind: 39000 · Signed with your nsec · Published to wss://relay.damus.io, wss://nos.lol",
  },
  {
    title: "Bidders Place Bids",
    description: "Bidders create a P2PK-locked Cashu proof locked to the seller's pubkey. The proof has a locktime (auction end + 24h) and a refund path back to the bidder.",
    detail: "P2PK lock: keyset_id + C + secret · Locktime: end_time + 24h · Refund: bidder pubkey",
  },
  {
    title: "Auction Extends (Anti-Sniping)",
    description: "If a bid arrives in the last 5 minutes, the auction auto-extends by 5 more minutes. This prevents last-second sniping and gives other bidders time to respond.",
    detail: "Extension: +5 min · Trigger: bid within last 5 min of end_time · Max: indefinite while bids arrive",
  },
  {
    title: "Settlement",
    description: "When the auction ends with no more bids, the highest verified bid wins. The auction state changes to SETTLED and the winner is recorded on-chain.",
    detail: "State: ACTIVE → EXTENDED → SETTLED · Winner: highest bid ≥ start_price",
  },
  {
    title: "Claim",
    description: "The seller can claim the winning P2PK-proof after the locktime passes (24h after end_time). The proof is swapped from the mint into the seller's wallet.",
    detail: "Locktime: end_time + 24h · Swap: mint.v1/swap · Proof: spendable by seller pubkey only",
  },
]
