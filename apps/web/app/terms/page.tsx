export const metadata = {
  title: "Terms & Guidelines — eGavel",
  description: "eGavel auction terms and guidelines",
}

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(24px, 3vw, 32px)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          marginBottom: 8,
        }}
      >
        Terms & Guidelines
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 32 }}>
        Last updated: 2026-08-13
      </p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          1. Peer-to-peer marketplace
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)" }}>
          eGavel is a peer-to-peer auction platform. Listings are created and
          fulfilled directly between the seller and the winning bidder. The
          platform facilitates the auction and the payment settlement, but is
          not a party to the underlying transaction.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          2. Non-custodial funds
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)" }}>
          The platform never holds your funds. Bids are protected by a 2-of-3
          P2PK lock (seller, server, bidder) on the Cashu mint — no single
          party, including the server, can move the funds alone. If the server
          were to disappear, locked funds are recoverable by the bidder after
          the locktime via the refund key.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)", marginTop: 12 }}>
          <b>You are responsible for your own funds.</b> Your account is a
          12-word recovery phrase stored only in this browser. The platform
          does not keep a copy of it and cannot restore it for you. You must
          write down and safely store your recovery phrase.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)", marginTop: 12 }}>
          <b>Recovery.</b> The app uses a single fixed mint. As long as you
          have your recovery phrase, your balance can be regenerated
          automatically (NUT-13) on any device — the phrase alone is
          sufficient; you do not need to remember the mint URL.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)", marginTop: 12 }}>
          <b>Browser storage.</b> Funds are stored in this browser's local
          storage, which may be cleared by the browser (for example, Safari's
          Intelligent Tracking Prevention can delete it after about 7 days
          without visiting the site). Without your recovery phrase, funds
          stored only in browser local storage cannot be recovered.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          3. Payments and settlement
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)" }}>
          Bidders fund their eGavel wallet by minting e-cash with a Lightning
          payment (the displayed invoice). Bids are placed and settled in
          e-cash, not directly over Lightning. After an auction ends, the
          seller claims the winning bid via a 2-of-3 co-signature, receiving
          the sale proceeds (minus any platform fee). The winner receives the
          difference between their locked maximum and the standing price back
          as change.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          4. Shipping and fulfillment
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)" }}>
          Shipping and delivery are a private agreement between the seller and
          the winning bidder. After settlement, the winner submits a shipping
          address, which the seller can view on their dashboard. The platform
          does not handle, insure, or guarantee delivery of any physical item.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          5. Prohibited listings
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)" }}>
          You may not list illegal goods, counterfeit items, stolen property,
          or anything that violates applicable law. You may not engage in
          fraudulent bidding, bid shilling, or any practice intended to
          manipulate an auction's outcome.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          6. Disclaimer
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)" }}>
          The platform provides the auction and settlement mechanism as-is,
          without warranty. It is not responsible for the condition, accuracy,
          or delivery of listed items, nor for disputes between buyers and
          sellers. Auction fairness rests on open-source code, self-hosting,
          and operator reputation. Use at your own risk.
        </p>
      </section>
    </main>
  )
}
