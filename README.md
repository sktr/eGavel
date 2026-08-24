# eGavel

**▶ Try it live: [egavel.vercel.app](https://egavel.vercel.app)**

A **non-custodial** auction platform built on Cashu e-cash.

Bids are locked with a **2-of-3 P2PK** lock — the seller, the auction server, and the bidder each hold one key, and no one can move the funds without two signatures. The bid amount is a **maximum**; the engine bids automatically (second-price / proxy bidding) at the second-highest max plus the minimum increment. The winner pays only the standing price, and **outbid bids are refunded instantly**. After settlement (and the seller's claim), proceeds sit in a **fulfillment escrow** — the seller marks shipped, the winner confirms receipt to release, and a symmetric 14-day timeout guarantees neither party can lock the other out.

## Features

- **Proxy bidding (second price)** — the entered amount is a maximum. The engine bids just enough to stay in the lead, and the winner pays only the standing price.
- **2-of-3 non-custodial bids** — no single party (including the server) can move the funds alone.
- **Instant outbid refunds** — the moment a higher bid arrives, the losing bid's funds return to the wallet automatically.
- **Fulfillment escrow (v1)** — claim creates a `{seller+winner+server}` 2-of-3 lock (refund winner @ claim+14 days) with a single boolean `shipped` flag. Winner confirms receipt to release; after 14 days the seller can self-release if shipped, or the winner can self-refund if not — the server alone can never move the funds, so neither party can be locked out. Degenerate `seller_net=0` skips escrow.
- **Anti-sniping / Reserve / Buy Now / Watchlist** — standard auction features.
- **Nostr-linked identity** — a Nostr key (NIP-07 extension or nsec) is linked to the trading key via a signed NIP-98 event; linking is required to list and to bid, and the link is permanent. The seller is public (their npub links to nostr.at); the winner stays anonymous publicly and is revealed only to the seller (and themselves) after settlement.
- **NIP-99 marketplace mirror** — listings are published as kind `30402` addressable events (`d=egavel-<id>`) to Nostr relays for discovery (server-enforced — `POST /auctions` requires `id` + signed `30402` with `d=egavel-<id>`; no listing can exist without a valid mirror, even via direct API). Tags carry `title`/`summary`/`price`/`image`/`r`/`expiration` plus custom `reserve`/`buy_now`/`auction:start|end`. Deletion publishes kind `5`. View on Nostr via `naddr` (`nostr.at`).
- **Blossom image hosting (NIP-B7)** — images are uploaded via Blossom (`kind 24242` auth, `PUT /upload`) to `blossom.primal.net` (fallback `cdn.nostrcheck.me`). The DB stores only URLs; base64 inline is capped at 4 images / 2 MB.
- **Public audit log** — bids publish hash + standing price as kind `1021`; escrow transitions (`shipped`/`confirmed`/`released`/`refunded`) publish kind `1022` with `[status]` tags. Fire-and-forget, never on the critical path.
- **NUT-13 deterministic wallet** — every ecash output derives from your 12-word recovery phrase, so restoring the phrase on another device automatically recovers your balance (no mint URL needed).
- **Multi-mint wallet** — receive Cashu tokens from any mint, view combined balances, and withdraw per mint (token or Lightning).
- **Zero platform fee** — the operator takes no cut (`AUCTION_FEE_BPS` defaults to 0).

## Quick start

### Prerequisites

- Node.js 24+ / pnpm 11+
- For testing: [testnut.cashu.space](https://testnut.cashu.space) (test Cashu mint; invoices are auto-paid in a few seconds)

### Setup

```bash
pnpm install
```

Generate a server signing key (the server's key in the 2-of-3 lock):

```bash
openssl rand -hex 32
```

Write `apps/server/.env` (see `apps/server/.env.example`):

```bash
SERVER_PRIVATE_KEY=<64-char hex>  # server signing key generated above
PORT=3001
DB_PATH=data/auction.db
AUCTION_FEE_BPS=0                 # seller fee (0 = free marketplace; 500 = 5%)
```

### Run

```bash
pnpm dev        # server :3001 / web :3000
```

1. Open `http://localhost:3000`
2. On first visit, save the 12-word recovery phrase shown to you
3. **Create Listing** — the mint is fixed by the app config (dev builds use the testnet mint `testnut.cashu.space`)
4. Use **Get Sats** on the detail page to get test sats
5. **Place Bid** with a **maximum** — watch the standing price rise automatically, and see outbid bids refund instantly

### Tests

The server suite runs fully offline (in-memory SQLite, no mint needed); the web suite covers the pure logic modules.

```bash
pnpm --filter @egavel/server test
pnpm --filter @egavel/web exec vitest run
```

## Documentation

- **How it works (for the Cashu community)**: [`docs/how-it-works.md`](docs/how-it-works.md)
- **Technical architecture** (P2PK lock structure, state machine, API flows): [`docs/technical-architecture.md`](docs/technical-architecture.md)
- **Security & threat model**: [`docs/security.md`](docs/security.md)

## References

- [NUT-11 — P2PK](https://github.com/cashubtc/nuts/blob/main/11.md) — the 2-of-3 lock for bids and the fulfillment escrow
- [NUT-13 — Deterministic Secrets](https://github.com/cashubtc/nuts/blob/main/13.md) — 12-word phrase → ecash outputs (balance recovery)
- [NIP-07 — `window.nostr` Capabilities](https://github.com/nostr-protocol/nips/blob/master/07.md) — browser extension signing
- [NIP-98 — HTTP Auth](https://github.com/nostr-protocol/nips/blob/master/98.md) — trading ↔ Nostr link (`link:<pubkey>`)
- [NIP-99 — Classified Listings](https://github.com/nostr-protocol/nips/blob/master/99.md) — kind `30402` marketplace mirror (`d=egavel-<id>`)
- [Blossom — Content-Addressed Storage](https://github.com/hzrd149/blossom) — `kind 24242` auth + `PUT /upload` for images (NIP-B7)

## License

MIT
