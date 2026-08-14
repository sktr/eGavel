# Technical Architecture

## Overview

```
apps/web        Next.js frontend (wallet, bidding, dashboard)
apps/server     Hono API (listings, bids, settle, claim) + SQLite / D1
packages/shared shared types
```

- **Listings**: `POST /api/auctions` (plain HTTP — no relay dependency)
- **Bid flow**: the client creates a 2-of-3 P2PK proof bundle (locking the full max) → `POST /api/bids` → the server validates (NUT-06/NUT-07) → computes the standing price from all bidders' maxes (second-highest max + minimum increment, `min-increment` table)
- **Refunds**: outbid detection (polling) → bidder signature + server co-sign → mint swap
- **Claim**: seller signature + server co-sign → the server splits the outputs into `[seller, operator fee, winner change]` (change = locked max − standing price; the winner collects via `GET /api/auctions/:id/change`)
- **Timing**: event-driven — anti-sniping extends by 5 minutes at bid time for bids in the last 5 minutes before E; an auction settles (lazy) the first time it is read after `end_time + 30s` (grace)
- **Shipping**: the winner posts a Schnorr-signed payload to `POST /api/auctions/:id/shipping` (the server verifies the signature against the winner key)

## P2PK lock structure (each bid)

```
data    = seller
pubkeys = [server, bidder]
n_sigs  = 2
locktime = end_time + 24h (seconds)
refund  = bidder
```

- `data` (seller) and the two `pubkeys` (server, bidder) form the 2-of-3 set; any two signatures unlock.
- The server can never move funds alone — it only co-signs the claim (seller + server) or the refund (bidder + server).
- If the server disappears, funds are locked until the locktime, then the bidder recovers via the `refund` key.

## Auction state machine

```
PENDING → ACTIVE → (EXTENDED)* → CLOSED/SETTLED
```

- `ACTIVE`: open for bids.
- `EXTENDED`: anti-sniping — a bid within the last 5 minutes adds 5 more minutes.
- `SETTLED`: after `end_time + 30s` (grace window), the leader wins at the standing price if it meets the reserve; otherwise `winner_npub` is null (reserve not met).
- Buy Now: a max reaching `buy_now_price` settles immediately at that price.
- Delete: a seller can remove a listing only while it is `ACTIVE` with zero bids (`DELETE /api/auctions/:id`).

## Server signing key

The server's key in the 2-of-3 lock is a **64-char hex** secp256k1 private key. It is set via `SERVER_PRIVATE_KEY` (Node env or Worker binding).

```bash
# Generate one (openssl)
openssl rand -hex 32
```

Write `apps/server/.env`:

```bash
SERVER_PRIVATE_KEY=<64-char hex>  # server signing key
PORT=3001
DB_PATH=data/auction.db
ALLOW_TEST_BIDS=1                 # dev only (allows the test://local mint)
AUCTION_FEE_BPS=500               # seller fee 5%
```
