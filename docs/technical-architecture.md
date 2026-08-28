# Technical Architecture

## Overview

```
apps/web        Next.js frontend (wallet, bidding, dashboard, escrow panel, NIP-99/Blossom)
apps/server     Hono API (listings, bids, settle, claim/escrow, NIP-99 audit) + SQLite / D1
packages/shared shared types
```

- **Listings**: `POST /api/auctions` (`{ id, ..., nostr_event }` — `id = sellerPubkey-Date.now()`, `nostr_event` is a signed kind `30402` with `d=egavel-<id>`) → server verifies `30402` (kind/pubkey/d/sig) against the seller's linked Nostr key and saves; then fire-and-forget publishes the same event to relays. No listing can be created without a valid NIP-99 mirror, even via direct API. Blossom image URLs are `string[]` (≤4)
- **Images**: `BlossomClient` (`PUT /upload` with `kind 24242` auth) to `blossom.primal.net` (fallback `cdn.nostrcheck.me`); `auctions.images` is `string[]` of URLs (≤4, total ≤2 MB)
- **Bid flow**: the client creates a 2-of-3 P2PK proof bundle (locking the full max) → `POST /api/bids` → the server validates (NUT-06/NUT-07) → computes the standing price from all bidders' maxes (second-highest max + minimum increment, `min-increment` table)
- **Refunds**: outbid detection (polling) → bidder signature + server co-sign → mint swap
- **Claim → direct pay (default)**: `POST /auctions/:id/claim` (seller per-secret sigs + server) → server splits into `[seller net (1-of-1 P2PK returned in the response → wallet), operator fee, winner change]`. The fulfillment-escrow branch below is DORMANT unless `escrowEnabled` is set (`{seller,winner,server}` 2-of-3 P2PK, refund winner @ claim+14d, `shipped=0`; `seller_net=0` skips escrow). Escrow creation happens inside the claim call because bid proofs are seller-locked — the server cannot swap them alone (non-custodial).
- **Shipped**: `POST /auctions/:id/shipped` (seller Schnorr over `shipped:<id>`) → flips the boolean `shipped` flag only; no funds move. Shipping details travel in private Nostr DMs, never through the platform.
- **Confirm**: `POST /auctions/:id/confirm` (winner `confirm:<id>` + per-secret sigs) → server verifies + co-signs → `settleEscrowTo` swaps into 1-of-1 P2PK proofs for the seller → `pending_receives` → seller collects via `GET /wallet/receive`
- **Release** (timeout-gated): `POST /auctions/:id/release` (seller `release:<id>` + per-secret sigs; requires `shipped && now ≥ created_at+14d`) → same swap as confirm but payee = seller
- **Refund** (timeout-gated): `POST /auctions/:id/refund` (winner `refund:<id>` + per-secret sigs; requires `!shipped && expired`) → swap into winner-owned proofs
- **Read**: `GET /auctions/:id/escrow` (Schnorr `escrow-view:<id>` verified BEFORE any existence check — bad sigs always get 401; seller/winner only; returns `proofs_data`, `shipped`, `timeout_expired`)
- **Timeout policy**: party-triggered only. The server holds one of three keys and can never move or delete escrowed funds itself; `settleIfDue`'s timeout pass is observe-only (logs, never deletes rows)
- **Claim change**: the excess is collected via `GET /api/auctions/:id/change`
- **Timing**: event-driven — anti-sniping extends by 5 minutes at bid time for bids in the last 5 minutes before E; an auction settles (lazy) the first time it is read after `end_time + 30s` (grace)
- **Winner contact (npub handoff)**: after settlement the winner stays anonymous publicly. The winner's linked Nostr npub is revealed only to the seller (and to the winner themselves) via a Schnorr-signed read of `GET /api/auctions/:id` (`winner-view:<id>`) — the seller sees it in Settlement Info, so they can verify an inbound contact is the genuine winner. Contact happens in the user's own Nostr client (nostr.at). The platform collects no shipping address.
- **Audit log (fire-and-forget)**: bids → kind `1021` (hash + standing); escrow → kind `1022` with `[status]` tags (`shipped` / `confirmed` / `released` / `refunded`) — never `secret`, `proof`, or `max`

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

### Fulfillment escrow (v1 rev 2 — DORMANT, `escrowEnabled` opt-in)

```
Escrow: {seller, winner, server} 2-of-3, locktime=claim+14d (ESCROW_TIMEOUT_MS), refund=winner
```

Built at the claim swap via `OutputData.createP2PKData(buildEscrowLockOptions(...), sellerNet, keyset)` (`apps/server/src/lib/escrow.ts`). Resolution paths:
- **Winner confirm** any time after shipping: witnesses `[winner_sig_i, server_sig_i]`
- **Seller release** after shipped + 14 days: witnesses `[seller_sig_i, server_sig_i]`
- **Winner refund** after unshipped + 14 days: witnesses `[winner_sig_i, server_sig_i]` (after locktime the winner's refund key alone would also sweep — funds can never strand)

Every path runs through `settleEscrowTo` (`routes/auctions.ts`): verify party per-secret signatures → fee-aware swap → persist to `pending_receives` with retries → delete escrow row. Witnesses must be REAL client-signed per-secret signatures; signing with a public key can never verify at a mint. Future arbiter: `seller+winner+server+arbiter` 2-of-4.

## DB & migrations

```
auctions, bids, bid_proofs, fees, change_returns, nostr_links, pending_receives,
fulfillment_escrows  ← migration 0008 (v1 shape; rewritten in place — see caveat below)
```

```sql
CREATE TABLE IF NOT EXISTS fulfillment_escrows (
  auction_id      TEXT PRIMARY KEY REFERENCES auctions(id),
  shipped         INTEGER NOT NULL DEFAULT 0,       -- boolean flag; the ONLY fulfillment state the server stores
  proofs_data     TEXT NOT NULL,                    -- locked escrow proof bundle JSON (ONLY persisted copy of the secrets)
  created_at      INTEGER NOT NULL
);
```

- Dual-maintained: `migrations/0008_fulfillment_escrows.sql` (D1) + `initDb()` DDL (better-sqlite3), and both `src/db/index.ts` / `src/db/d1.ts` implement `saveEscrow`/`getEscrow`/`setShipped`/`deleteEscrow`.
- ⚠️ Migration history lesson: 0008 was originally applied remotely as an 8-column two-stage table and later REWRITTEN in place — remote D1 therefore never gained `shipped`. Migration `0009_fulfillment_escrows_rebuild.sql` rebuilds legacy tables to the v1 shape; never rewrite an applied migration again.
- `pending_receives` also backs escrow release: confirm/release/refund write `pending_receives` for the payee (same as NUT-18 `POST /wallet/receive`).

## Auction state machine

```
PENDING → ACTIVE → (EXTENDED)* → CLOSED/SETTLED
                              ↘ claim → direct pay (seller wallet)
                                 ↘ escrow — DORMANT unless escrowEnabled
                                   (shipped → confirmed | release@timeout | refund@timeout)
```

- `ACTIVE`: open for bids.
- `EXTENDED`: anti-sniping — a bid within the last 5 minutes adds 5 more minutes.
- `SETTLED`: after `end_time + 30s` (grace window), the leader wins at the standing price if it meets the reserve; otherwise `winner_npub` is null (reserve not met). Then `claimed` flag gates the claim button; escrow lives in `fulfillment_escrows`.
- Buy Now: a max reaching `buy_now_price` settles immediately at that price.
- Delete: a seller can remove a listing only while it is `ACTIVE` with zero bids (`DELETE /api/auctions/:id`). The client also best-effort deletes the NIP-99 kind `5` and Blossom blobs.

## NIP-99 + Blossom

- **Blossom**: `apps/web/lib/blossom.ts` wraps `PUT /upload` with `Authorization: Nostr <base64(24242)>`; primary `https://blossom.primal.net` (env `NEXT_PUBLIC_BLOSSOM_URL`), fallback `https://cdn.nostrcheck.me`.
- **NIP-99**: `apps/web/lib/nostr-listing.ts` builds kind `30402` (`d=egavel-<id>`, `title`/`summary`/`price`/`t`/`image`/`r`/`published_at`/`expiration`/`reserve`/`buy_now`/`auction:start|end` + `location` shipping text), signed via NIP-07 (or pasted nsec) before `POST`. The client additionally fire-and-forget publishes the already-signed event to relays on create (`publishSignedEvent`). Server verifies with `lib/nip99.ts:verifyNip99ListingEvent` (kind/pubkey/d/sig/`created_at` ±10 min) and also fire-and-forget publishes via `SimplePool.publish` to `["wss://relay.damus.io","wss://nos.lol","wss://relay.nostr.band"]`. `naddr` (`a:30402:pubkey:d`) is shareable via `nostr.at`. Mirror is **server-enforced**: `POST` without a valid `30402` is rejected.
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
AUCTION_FEE_BPS=0                 # seller fee (0 = free marketplace; 500 = 5%)
NEXT_PUBLIC_BLOSSOM_URL=https://blossom.primal.net
NEXT_PUBLIC_BLOSSOM_FALLBACK_URL=https://cdn.nostrcheck.me
```
