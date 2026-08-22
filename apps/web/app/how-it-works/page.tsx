import { CreateAuctionGuard } from "../../components/create-auction-guard";

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
        How it Works
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 16, marginBottom: 48, maxWidth: 560, lineHeight: 1.6 }}>
        eGavel is a non-custodial auction site. You keep your own keys, bid with
        sats, and settlement happens automatically when an auction ends.
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
            { title: "Nostr identity", desc: "A Nostr key is linked to your trading key with a signed event — the link is required to list and to bid, and it is permanent. The seller's handle is public; the winner's handle is revealed only to the seller (and to the winner themselves) after settlement." },
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
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 16, lineHeight: 1.6 }}>
          For developers: the full technical architecture (API endpoints, the 2-of-3 P2PK lock
          structure, settlement state machine, and fee model) is documented in the{" "}
          <a href="https://github.com/sktr/egavel" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>
            repository README
          </a>
          .
        </p>
      </div>

      {/* Footer links */}
      <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 48 }}>
        <CreateAuctionGuard style={{ color: "var(--accent)", textDecoration: "none" }}>Create your first auction</CreateAuctionGuard>
        {" · "}
        <a href="/" style={{ color: "var(--accent)", textDecoration: "none" }}>Browse auctions</a>
      </p>
    </div>
  )
}

const steps = [
  {
    title: "Create an auction",
    description:
      "Describe your item, set a starting price and how long the auction runs. Your account is your key — there is no sign-up and no email. You first link a Nostr identity (via a NIP-07 extension or a private key) so buyers can verify who you are and reach you after the sale.",
  },
  {
    title: "Bidders place bids",
    description:
      "Bidders enter the maximum they are willing to pay. The system only bids as much as needed to stay in the lead, so you never pay more than necessary. Each bid is secured so that no one — not even the platform — can touch the funds alone.",
  },
  {
    title: "Ending soon? The auction extends",
    description:
      "If a bid arrives in the last 5 minutes, the auction automatically extends by 5 more minutes. This prevents last-second sniping and gives everyone a fair chance to respond.",
  },
  {
    title: "The auction settles",
    description:
      "When time runs out, the highest bidder wins at the final price. Payment and settlement happen automatically — no manual steps, no waiting.",
  },
  {
    title: "Claim and change",
    description:
      "The seller receives the full sale proceeds — eGavel charges no platform fee. The winner gets any excess back automatically, and losing bidders are refunded instantly. Once settled, the seller and the winner can see each other's Nostr handle and connect to arrange delivery.",
  },
]
