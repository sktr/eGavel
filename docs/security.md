# Security & Threat Model

Cashu Auction is a **non-custodial** auction platform. The core security claim is:

> **The server can never move user funds alone.** Bids are locked as 2-of-3 P2PK
> e-cash proofs (seller + server + bidder keys, `n_sigs = 2`), and all fund
> movements require a co-signature from a second party. The same holds for the
> fulfillment escrow — every release needs two signatures.

This document describes the trust model, the money flows, and the known
limitations. It is written from the perspective of someone deploying or
auditing this software.

## Trust model

| Party  | Can do | Cannot do |
| ------ | ------ | --------- |
| Bidder | Lock a bid; instantly refund when outbid (with server co-sign); sweep Stage 1 escrow after +10 d if seller never ships; confirm receipt to release Stage 2 | Spend another party's funds |
| Seller | Claim the winner's proofs after settlement (with server co-sign) → escrow; report tracking; sweep Stage 2 after +30 d if winner ghosts; co-sign voluntary splits | Move funds alone; spend without tracking (Stage 1 refund blocks it) |
| Winner | Confirm receipt (with server co-sign) to pay seller; approve tracking for relock; sweep Stage 1 on timeout | Spend seller's escrow alone |
| Server | Verify bids/tracking, pick the winner, co-sign claims/refunds/relocks/releases/splits; fallback-co-sign relock after 72 h (audit-visible) | Move funds alone (2-of-3/2-of-4 enforced cryptographically) |
| Mint   | Hold and swap e-cash | Steal proofs (bearer instruments, but see "Mint dependency" below) |
| Nostr relays / Blossom | Mirror listings (30402) and audit log (1021/1022); host images | Touch settlement — DB + mint remain canonical |

The server's honesty for **auction fairness** (did it accept my bid, did it
settle correctly, did it co-sign a fallback early?) is NOT cryptographically
enforced. It rests on the OSS code, self-hosting, and operator reputation.
The non-custodial guarantee is only about **money safety against single-party
failure** — any two keys *can* collude (e.g. `server+winner` draining Stage 2),
which degrades to the unprotected baseline and is audit-visible.

## Money flows (all 2-of-3)

1. **Bid**: the bidder creates a P2PK bundle locked to `{seller, server, bidder}`,
   `n_sigs = 2`, `locktime = end + 7 days`, `refund = bidder`. The server verifies
   the lock structure, the mint (NUT-06/07/12) and records the proofs.
2. **Instant refund (outbid)**: bidder signature + server co-signature over the
   proof secrets → the bidder swaps the proofs back to themselves. No locktime wait.
3. **Claim → Stage 1 escrow**: seller signature + server co-signature → the server
   runs a swap that splits the winner's proofs into `[seller net → Stage 1
   escrow, operator fee, winner change]`. Stage 1 is
   `{seller,winner,server} 2-of-3, refund winner @ claim+10d`. If `seller_net==0`
   no escrow is created (instant release); `ESCROW_MODE=legacy` disables the
   escrow entirely.
4. **Tracking + relock → Stage 2**: seller reports a tracking number (format-only
   validation: S10 UPU check digit `weights [8,6,4,2,3,5,9,7]`, UPS `1Z…`, FedEx
   12|15, DHL 10; rejected within 24 h of `claim+10d`). The server validates and
   stores `tracking_number/kind`. Relock swap: Stage 1 proofs in
   (`seller + winner` or, after 72 h silence, `seller + server` fallback) →
   Stage 2 proofs out `{seller,winner,server} refund seller @ report+30d`.
   Write-ordering: Stage 2 output secrets are persisted as `migrating` before
   the swap; crash recovery via NUT-07 `checkProofsStates` + `restore`.
5. **Confirm receipt**: winner signs secrets + `confirm:<id>` → server-mediated
   release swap → 1-of-1 P2PK to seller (delivered via `pending_receives`, collected
   with `GET /wallet/receive`). `confirmed`.
6. **Voluntary split**: `seller+winner` sign `split:<id>:<hash>` and per-secret
   witnesses → server executes the agreed `splits` outputs (`split_resolved`).
7. **Change return**: the excess (locked max − standing price) is a 1-of-1 P2PK
   output to the winner, collected via `GET /api/auctions/:id/change`.
8. **Timeouts**: Stage 1 expiry → winner sweeps alone (refund key, zero server
   involvement — proofs delivered via `GET /escrow`); Stage 2 expiry → seller
   sweeps alone. `seller+winner` can also unlock cooperatively at any time.

## Controls in place

- **P2PK structure validation** (`verify`): data == seller, pubkeys ⊇ {server,
  bidder}, `n_sigs == 2`, locktime ≥ end + 7 days, refund ⊇ bidder, sigflag =
  SIG_INPUTS. Rejects malformed locks.
- **Mint checks**: NUT-06 capability check (mint must support NUT-07/08/10/11),
  best-effort NUT-12 DLEQ, NUT-07 unspent check — **fail-closed**: if the mint
  is unreachable, the bid is rejected.
- **Proof double-lock guard**: the same proofs (same `Y` hashes) cannot back
  more than one bid. Locked in `bid_proofs` (UNIQUE on Y) before the bid is
  saved; concurrent cross-auction races are closed by lock-then-verify
  ordering with rollback.
- **Signature verification**: claim/refund/co-sign/escrow paths verify Schnorr
  signatures over the proof secrets against the expected key (seller for
  claim/tracking, bidder/winner for refund/confirm, both for split/relock).
  The `proofs_data` endpoints return P2PK-locked proofs — harmless to disclose,
  the effective gate is the co-sign check.
- **Tracking validation** (`lib/tracking.ts`): S10 check digit with UPU weights
  `[8,6,4,2,3,5,9,7]` (`11-(sum%11)`, `10→0`/`11→5`), UPS/FedEx/DHL regex. Invalid
  formats never migrate; the 24 h cutoff and 72 h fallback are code-enforced.
- **Escrow write-ordering & reconciliation**: relock persists `migrating` with
  serialized Stage 2 output secrets before the swap; `POST /escrow/reconcile`
  recovers via NUT-07 state checks and `restore` (never blind-resubmits).
- **Winner contact (npub handoff)**: after settlement the winner's linked
  Nostr npub is revealed only to the seller (and to the winner themselves) via
  a Schnorr-signed read (`winner-view:<id>`); it is never included in public
  listings or anonymous reads. Contact happens in the user's own Nostr client.
  The platform collects no shipping address.
- **NIP-99 / Blossom privacy & enforcement**: listings mirror to relays as kind `30402`
  (`d=egavel-<id>`, `price=buy_now ?? start_price`, `r`/`expiration`/custom
  `reserve`/`buy_now`/`auction` tags) — `POST /auctions` requires `id` +
  signed `30402` (`d=egavel-<id>`, `pubkey == linked Nostr pubkey`, sig valid;
  verified via `lib/nip99.ts:verifyNip99ListingEvent`); no listing can be created
  without a valid mirror, even via direct API. Settlement fields (`max`,
  `standing`) stay in DB. Images are content-addressed Blossom URLs (60 bytes
  each); the DB holds pointers only. Audit log kind `1021` (bid hash + standing)
  and `1022` (escrow `shipped/confirmed/split/fallback`) never carry `secret`,
  `proof`, `max`, or the tracking *number* (only *kind*).
- **Rate limits** (`lib/rate-limit.ts`): bids 30/min, auction creation
  10/min, co-sign 20/min, claim-data/refund-data/escrow-read 30/min,
  tracking/confirm/relock/split 20/min.
- **Max secrecy**: the API exposes only the standing price; `max_amount`
  stays server-side (second-price incentive protection).

## Known limitations (honest)

1. **Auction fairness is not enforced.** A malicious operator can reject bids,
   settle incorrectly, censor, or co-sign a fallback early/never. This is
   inherent to a single-server auctioneer and is mitigated by OSS code,
   self-hosting, reputation, and audit-log visibility — not by the protocol.
2. **Server-signed attestations only.** Nothing here proves the actual
   on-mint movement of funds to a third party; proofs are not disclosed
   (privacy trade-off).
3. **Mint dependency.** If the mint disappears or refuses to serve, locked
   e-cash is stranded. This is a Cashu-ecosystem property, not specific to
   this project. Mint outages near the `claim+10d` boundary cause the Stage 1
   refund to proceed gracefully (seller keeps item).
4. **`ALLOW_TEST_BIDS=1` bypasses mint checks.** With the test mint
   (`test://local`), the NUT-07 unspent check and mint reachability are
   skipped. Must be `0` in production.
5. **Legacy data.** Bids created before the proof double-lock guard are not in
   `bid_proofs`; their proofs could in theory be re-submitted (NUT-07 would
   still catch already-spent ones). New bids are fully guarded.
6. **Server key custody.** `SERVER_PRIVATE_KEY` is the server's co-signing key.
   If leaked, an attacker still cannot move funds alone (needs a second
   party), but they can grief (co-sign refunds of outbid bids they control,
   or refuse to co-sign). Protect it like any signing key.
7. **Fulfillment quality disputes are out of scope in v1.** The escrow
   guarantees *that* a shipment was initiated (tracking) and *that* funds
   move on confirmation/timeout, but not *what* was shipped. "Arrived but
   fake" / "tracking real but item lost" are handled off-platform via Nostr
   negotiation + voluntary split + permanent Nostr-link accountability. A
   future arbiter registry (opt-in premium, `seller+winner+server+arbiter`
   2-of-4, paid upfront per protection count) is designed but deferred
   (see `2026-08-23-two-stage-fulfillment-escrow-design.md` §9).
8. **No moderation of Nostr/Blossom mirrors.** Relays and Blossom servers are
   third-party; listings there are eventually consistent and not moderated by
   this server. `DB` remains canonical for settlement.

## Deployment checklist

- `ALLOW_TEST_BIDS=0`
- `SERVER_PRIVATE_KEY` from a secure store (not committed; never in the repo;
  Cloudflare Worker: `wrangler secret put SERVER_PRIVATE_KEY`, not a `vars` entry)
- `ESCROW_MODE` set deliberately (`two-stage` default, `legacy` to disable escrow)
- `AUCTION_FEE_BPS` set deliberately
- `NEXT_PUBLIC_BLOSSOM_URL` / `_FALLBACK` (`blossom.primal.net` / `cdn.nostrcheck.me` defaults)
- HTTPS in front of the API (TLS is mandatory for mint/bid/escrow traffic)
- SQLite backups (`data/auction.db`) — `proof_data` and `fulfillment_escrows.proofs_data`
  must be persisted (P2PK secrets needed for co-sign; escrow `migrating` recovery
  needs serialized output secrets)
- D1 migrations applied (`wrangler d1 migrations apply egavel-db --remote`,
  fallback `wrangler d1 execute`)
- Run the test suite before upgrades; the settle/claim/escrow/relock paths are the
  money paths (`pnpm --filter @egavel/server test` — 232 tests as of 2026-08-23)
