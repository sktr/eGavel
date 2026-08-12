# Cashu Auction

A **non-custodial** auction platform built on Cashu e-cash.

Bids are locked with a **2-of-3 P2PK** lock — the seller, the auction server, and the bidder each hold one key, and no one can move the funds without two signatures. The bid amount is a **maximum**; the engine bids automatically (second-price / proxy bidding) at the second-highest max plus the minimum increment. The winner pays only the standing price, and **outbid bids are refunded instantly**.

> **Status: working local MVP.** Core flows (proxy bidding, instant outbid refunds, claim with fee split, change return) are implemented and tested. Future plans: [ROADMAP.md](ROADMAP.md).

## Features

- **Proxy bidding (second price)** — the entered amount is a maximum. The engine bids just enough to stay in the lead (second-highest max + a per-band minimum increment), and the winner pays only the standing price. Locking the full max means bids are always fully collateralized.
- **Max secrecy** — the API exposes only `current_amount` (the standing price); `max_amount` stays server-side so the leader's limit can't be sniped with max+1.
- **2-of-3 non-custodial bids** — `data=seller, pubkeys=[server, bidder], n_sigs=2`. No single party can move the funds.
- **Instant outbid refunds** — the moment a higher bid arrives, the losing bid's funds return to the wallet automatically (bidder + server co-signature; no locktime wait).
- **Automatic change return** — the difference between the locked max and the standing price is returned to the winner as a change output during the seller's claim (`GET /api/auctions/:id/change`).
- **Guaranteed payment** — winning bids are fully locked; the winner can't run, and the seller is guaranteed collection via the server's claim swap.
- **Seller-paid fee** — the claim splits the winner's proofs into `[seller, operator fee, winner change]` (`AUCTION_FEE_BPS`, default 5%).
- **Anti-sniping / Reserve / Buy Now / Watchlist** — standard auction features (Buy Now settles at `buy_now_price` when a max reaches it).

## Trust model (honest description)

| Party | What they can do |
|-------|------------------|
| Bidder | Locks a bid. Instant refund when outbid (bidder + server co-signature). |
| Seller | Claims after settlement (seller + server co-signature) and receives the proceeds minus the fee. |
| Server | Verifies bids, picks the winner, co-signs claims/refunds. **Cannot move funds alone** (enforced cryptographically by 2-of-3). |

- **Your account is a client-generated key backed by a 12-word BIP-39 recovery phrase.** The private key never leaves the browser; restore it on any device with the phrase (see the Backup section on the dashboard). No passwords, no registration.
- **Fair auctioneering** rests on the OSS code, self-hosting, and the operator's reputation. The protocol cannot enforce shipping or authenticity of goods.

## Quick start

### Prerequisites

- Node.js 24+ / pnpm 11+
- For testing: [testnut.cashu.space](https://testnut.cashu.space) (test Cashu mint; invoices are auto-paid in a few seconds)

### Setup

```bash
pnpm install
```

Generate a server signing key (`apps/server/.env`) — the server's key in the 2-of-3 lock (a secp256k1 private key; nsec or hex both work):

```bash
cd apps/server
node -e "const { generateSecretKey, nip19 } = require('nostr-tools'); console.log('NOSTR_PRIVATE_KEY=' + nip19.nsecEncode(generateSecretKey()))"
```

Write `apps/server/.env` (see `.env.example`):

```bash
NOSTR_PRIVATE_KEY=nsec1...        # server signing key generated above
PORT=3001
DB_PATH=data/auction.db
ALLOW_TEST_BIDS=1                 # dev only (allows the test://local mint)
AUCTION_FEE_BPS=500               # seller fee 5%
```

### Run

```bash
pnpm dev        # server :3001 / web :3000
```

1. Open `http://localhost:3000`
2. On first visit, save the 12-word recovery phrase shown to you
3. **Create Listing** (Mint URL: `https://testnut.cashu.space`)
4. Use **Get Sats** on the detail page to get test sats
5. **Place Bid** with a **maximum** — watch the standing price rise automatically, and see outbid bids refund instantly

### Run with Docker

```bash
cp .env.example apps/server/.env   # if not present
NOSTR_PRIVATE_KEY=nsec1... docker compose up --build
```

- Server: `http://localhost:3001` · Web: `http://localhost:3000`
- SQLite data persists in the `auction-data` volume
- `ALLOW_TEST_BIDS` defaults to `0` in Docker (production-safe); override via `docker compose` env if you want the test mint

### Tests

```bash
pnpm --filter @cashu-auction/server test   # server 95 tests
cd apps/web && npx vitest run               # web 18 tests
```

## Architecture

```
apps/web        Next.js frontend (wallet, bidding, dashboard)
apps/server     Hono API (listings, bids, settle, claim) + SQLite
packages/shared shared types
```

- **Listings**: `POST /api/auctions` (plain HTTP — no relay dependency)
- **Bid flow**: the client creates a 2-of-3 P2PK proof bundle (locking the full max) → `POST /api/bids` → the server validates (NUT-06/NUT-07) → computes the standing price from all bidders' maxes (second-highest max + minimum increment, `min-increment` table)
- **Refunds**: outbid detection (polling) → bidder signature + server co-sign → mint swap
- **Claim**: seller signature + server co-sign → the server splits the outputs into `[seller, operator fee, winner change]` (change = locked max − standing price; the winner collects via `GET /api/auctions/:id/change`)
- **Timing**: settle at `end_time + 30s` (grace); anti-sniping extends by 5 minutes for bids in the last 5 minutes before E
- **Shipping**: the winner posts a Schnorr-signed payload to `POST /api/auctions/:id/shipping` (the server verifies the signature against the winner key)

## Design docs

- **Protocol spec**: [`docs/superpowers/specs/2026-08-11-cashu-auction-redesign-design.md`](docs/superpowers/specs/2026-08-11-cashu-auction-redesign-design.md)
- **Domain glossary**: [`CONTEXT.md`](CONTEXT.md)
- **UI design**: [`DESIGN.md`](DESIGN.md)

## References

- [NUT-11 (P2PK)](https://github.com/cashubtc/nuts/blob/main/11.md) — the locking mechanism used here

## License

MIT
