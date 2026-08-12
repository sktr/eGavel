# ROADMAP

Items designed and agreed in past sessions but **not yet implemented**. A map for when motivation returns.
(On 2026-08-12 the **Nostr dependency was fully removed** — the project was restructured as a pure Cashu app.)

## Implemented (as of 2026-08-12)

- **Proxy bidding (second price)**: `Bid` split into `max_amount`/`current_amount`; standing price = `min(highest max, 2nd-highest max + minBidIncrement)`; the full max is locked; the excess is returned to the winner as a change output in the claim swap (`GET /api/auctions/:id/change`). Buy Now settles when max ≥ buy_now_price.
- **Max secrecy**: the API exposes only `current_amount` via `toPublicBid` (`max_amount`, `Y`, `proof_data` stay server-side).
- **2-of-3 P2PK**: `data=seller, pubkeys=[server, bidder], n_sigs=2`. Instant outbid refunds (bidder+server co-sign), claim fee split (AUCTION_FEE_BPS), anti-sniping / grace settle / reserve / buy-now / watchlist.
- **Accounts = BIP-39 recovery phrase**: first-visit dialog + dashboard backup/restore. Legacy keys still load.
- **Listings over plain HTTP**: `POST /api/auctions` (no Nostr relay dependency).
- **Signed shipping**: winner-key Schnorr-signed payload (replaced kind:39004 event verification).

## 1. Image upload

**Status**: not implemented

Images are currently external URLs pasted into the description. Options:

- **A: self-hosted (R2)** — reliable, but brings moderation responsibility (natural fit with the serverless migration)
- **B: external URL** — current practice

## 2. Serverless migration (Cloudflare D1 + R2)

**Status**: planned — see [`docs/serverless-migration.md`](docs/serverless-migration.md) for the step-by-step plan (async Db refactor → D1 binding → Cron/DO scheduler → migrations → Vercel). Not started.

## 3. Reputation / review layer

**Status**: not implemented

The protocol cannot prevent a seller from not shipping or sending fakes. A reputation layer (completed auctions count, ratings) is needed eventually. Community × creator models depend on the sellers' existing reputation.

## 4. External signer (e.g. a Nostr extension)

**Status**: idea

If an extension with an arbitrary-message signing API appears (e.g. a `signString` addition to NIP-07, or a `window.cashu` namespace), add "sign with external signer" as an option while keeping the single-key model (currently the in-app key is the only signing path).

## Notes: why the Nostr dependency was removed (2026-08-12)

- Previously: listings (kind:39000), bids (kind:39001), and settlements (kind:39003) were published to Nostr relays as a "public audit log".
- Reasons for removal:
  1. Custom kinds are invisible to ordinary clients (damus / amethyst / iris.to) — you need your own tooling to see them.
  2. The events are server-signed, so verification only proves the public ledger's internal consistency — not the actual money flow, and not protection against a malicious operator.
  3. Kinds 39001/39003 fall in NIP-01's replaceable range (30000-39999); without a `d` tag, relays silently overwrite older events (a bug found during the audit work).
  4. Relay publishing was best-effort and frequently failed, undermining the ledger's own reliability.
- Conclusion: **the trust anchors are 2-of-3 P2PK + the mint (cryptography) and the OSS code** — a public ledger strengthened neither. Listings and shipping were moved to plain HTTP, making the app a self-contained Cashu application.
