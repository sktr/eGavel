# Technical Architecture

## Overview

```
apps/web        Next.js frontend (wallet, bidding, dashboard, escrow panel, NIP-99/Blossom)
apps/server     Hono API (listings, bids, settle, claim/escrow, NIP-99 audit) + SQLite / D1
packages/shared shared types
```

- **Listings**: `POST /api/auctions` (plain HTTP — no relay dependency) → client **blocking** mirrors to Nostr as kind `30402` (`d=egavel-<id>`) + Blossom image URLs (publish must succeed or the listing is rolled back; no Republish button on the product page)
- **Images**: `BlossomClient` (`PUT /upload` with `kind 24242` auth) to `blossom.primal.net` (fallback `cdn.nostrcheck.me`); `auctions.images` is `string[]` of URLs (≤4, total ≤2 MB)
- **Bid flow**: the client creates a 2-of-3 P2PK proof bundle (locking the full max) → `POST /api/bids` → the server validates (NUT-06/NUT-07) → computes the standing price from all bidders' maxes (second-highest max + minimum increment, `min-increment` table)
- **Refunds**: outbid detection (polling) → bidder signature + server co-sign → mint swap
- **Claim → escrow**: `POST /auctions/:id/claim` (seller+server) → server splits into `[escrow (Stage 1), operator fee, winner change]`; `seller net → fulfillment_escrows` (`stage 1, refund winner @ +10d`, `ESCROW_MODE=two-stage` default, `legacy` disables, `seller_net=0` skips)
- **Tracking**: `POST /auctions/:id/tracking` (seller `tracking:<id>:<number>` + `validateTracking` S10/UPS/FedEx/DHL, rejected within 24 h of `claim+10d`)
- **Relock**: `POST /auctions/:id/escrow/relock` (`seller sig + winner sig` or, after 72 h, `seller + server` fallback) → Stage 2 `{seller,winner,server} refund seller @ +30d` (write-ordering: persist `migrating` before swap; `POST /escrow/reconcile` via NUT-07/`restore`)
- **Confirm**: `POST /auctions/:id/confirm-receipt` (winner `confirm:<id>` + per-secret sigs) → server-mediated release → `pending_receives` → seller collects via `GET /wallet/receive`
- **Split**: `POST /auctions/:id/escrow/split` (`split:<id>:<hash>` + per-secret witnesses from both parties) → `split_resolved`
- **Read**: `GET /auctions/:id/escrow` (Schnorr `escrow-view:<id>`, seller/winner only, returns `proofs_data` for pure-locktime sweeps, plus `stage1_expired`)
- **Claim change**: the excess is collected via `GET /api/auctions/:id/change`
- **Timing**: event-driven — anti-sniping extends by 5 minutes at bid time for bids in the last 5 minutes before E; an auction settles (lazy) the first time it is read after `end_time + 30s` (grace)
- **Winner contact (npub handoff)**: after settlement the winner stays anonymous publicly. The winner's linked Nostr npub is revealed only to the seller (and to the winner themselves) via a Schnorr-signed read of `GET /api/auctions/:id` (`winner-view:<id>`) — the seller sees it in Settlement Info, so they can verify an inbound contact is the genuine winner. Contact happens in the user's own Nostr client (nostr.at). The platform collects no shipping address.
- **Audit log (fire-and-forget)**: bids → kind `1021` (hash + standing); escrow → kind `1021`/`1022` with `[status]`/`[tracking kind]`/`[note fallback_cosign]` (never the tracking number, `secret`, `max`, or `proof`)

## P2PK lock structure

### Each bid

```
data    = seller
pubkeys = [server, bidder]
n_sigs  = 2
locktime = end_time + 7 days (seconds, LOCKTIME_MS)
refund  = bidder
```

- `data` (seller) and the two `pubkeys` (server, bidder) form the 2-of-3 set; any two signatures unlock.
- The server can never move funds alone — it only co-signs the claim (seller + server) or the refund (bidder + server).
- If the server disappears, funds are locked until the locktime, then the bidder recovers via the `refund` key.

### Fulfillment escrow (two-stage)

```
Stage 1: {seller, winner, server} 2-of-3, locktime=claim+10d,  refund=winner  (winner vs seller ghost)
Stage 2: {seller, winner, server} 2-of-3, locktime=report+30d, refund=seller  (seller vs winner ghost)
```

Both stages are `n_sigs=2`; any cooperative pair can unlock immediately. `seller_net` is created as Stage 1 via `OutputData.createP2PKData(buildStage1LockOptions(...), sellerNet, keyset)`; relock builds Stage 2 via `buildStage2LockOptions`. Fees for the relock swap are reserved from the escrowed amount (seller-borne). Future arbiter: `seller+winner+server+arbiter` 2-of-4.

## DB & migrations

```
auctions, bids, bid_proofs, fees, change_returns, nostr_links, pending_receives,
fulfillment_escrows  ← new (migration 0008)
```

```sql
CREATE TABLE IF NOT EXISTS fulfillment_escrows (
  auction_id      TEXT PRIMARY KEY REFERENCES auctions(id),
  stage           INTEGER NOT NULL DEFAULT 1,       -- 1 | 2
  status          TEXT NOT NULL DEFAULT 'active',   -- active | migrating | confirmed | refunded_winner | swept_seller | split_resolved
  proofs_data     TEXT NOT NULL,                    -- current locked proof bundle JSON (migrating: envelope with pendingOutputs)
  tracking_number TEXT,
  tracking_kind   TEXT,                             -- s10 | ups | fedex | dhl
  migrated_at     INTEGER,
  created_at      INTEGER NOT NULL
);
```

- Dual-maintained: `migrations/0008_fulfillment_escrows.sql` (D1) + `initDb()` DDL (better-sqlite3), and both `src/db/index.ts` / `src/db/d1.ts` implement `saveEscrow`/`getEscrow`/`updateEscrowStage`/`setEscrowStatus`/`setEscrowTracking`.
- `pending_receives` also backs escrow release: `confirm-receipt` writes `pending_receives` for the seller (same as NUT-18 `POST /wallet/receive`).

## Auction state machine

```
PENDING → ACTIVE → (EXTENDED)* → CLOSED/SETTLED
                              ↘ claim → escrow (stage 1 → stage 2 → confirmed / split / timeout)
```

- `ACTIVE`: open for bids.
- `EXTENDED`: anti-sniping — a bid within the last 5 minutes adds 5 more minutes.
- `SETTLED`: after `end_time + 30s` (grace window), the leader wins at the standing price if it meets the reserve; otherwise `winner_npub` is null (reserve not met). Then `claimed` flag gates the claim button; escrow lives in `fulfillment_escrows`.
- Buy Now: a max reaching `buy_now_price` settles immediately at that price.
- Delete: a seller can remove a listing only while it is `ACTIVE` with zero bids (`DELETE /api/auctions/:id`). The client also best-effort deletes the NIP-99 kind `5` and Blossom blobs.

## NIP-99 + Blossom

- **Blossom**: `apps/web/lib/blossom.ts` wraps `PUT /upload` with `Authorization: Nostr <base64(24242)>`; primary `https://blossom.primal.net` (env `NEXT_PUBLIC_BLOSSOM_URL`), fallback `https://cdn.nostrcheck.me`.
- **NIP-99**: `apps/web/lib/nostr-listing.ts` builds kind `30402` (`d=egavel-<id>`, `title`/`summary`/`price`/`t`/`image`/`r`/`published_at`/`expiration`/`reserve`/`buy_now`/`auction:start|end` + `location` shipping text). Published via `SimplePool.publish` to `["wss://relay.damus.io","wss://nos.lol","wss://relay.nostr.band"]` (+ `wss://sendit.nosflare.com` withBlastr). `naddr` (`a:30402:pubkey:d`) is shareable via `nostr.at`. Mirror is client-signed and **blocking** — `create` awaits `publishListing` and rolls back (`DELETE`) on failure; the product page shows only `View on Nostr` + `Copy naddr` (no Republish).
- **Audit**: server publishes kind `1021` (bid `hash` + `standing`) and `1022` (escrow `[status]` etc.) fire-and-forget via `src/lib/audit-publish.ts` (`buildEscrowAuditEvent`/`publishEscrowAudit`).

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
AUCTION_FEE_BPS=0                 # seller fee (0 = free marketplace; 500 = 5%)
ESCROW_MODE=two-stage             # two-stage (default) | legacy (disable escrow)
NEXT_PUBLIC_BLOSSOM_URL=https://blossom.primal.net
NEXT_PUBLIC_BLOSSOM_FALLBACK_URL=https://cdn.nostrcheck.me
```
