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
| Bidder | Lock a bid; instantly refund when outbid (with server co-sign); refund a won auction themselves after the 14-day timeout if the seller never shipped | Spend another party's funds |
| Seller | Claim the winner's proofs after settlement (with server co-sign) → escrow; mark shipped (boolean flag); release the escrow to themselves after shipping + the 14-day timeout when the winner stays silent | Move funds alone; release before the timeout once shipped |
| Winner | Confirm receipt (per-secret signatures + server co-sign) to pay seller; self-refund after an unshipped timeout | Spend seller's escrow alone |
| Server | Verify bids, pick the winner, gate and co-sign confirm/release/refund swaps (`shipped` + elapsed-time gates) | Move funds alone (2-of-3 enforced cryptographically); unilaterally resolve a timeout |
| Mint   | Hold and swap e-cash | Steal proofs (bearer instruments, but see "Mint dependency" below) |
| Nostr relays / Blossom | Mirror listings (30402) and audit log (1021/1022); host images | Touch settlement — DB + mint remain canonical |

The server's honesty for **auction fairness** (did it accept my bid, did it
settle correctly?) is NOT cryptographically enforced. It rests on the OSS code,
self-hosting, and operator reputation. The non-custodial guarantee is only
about **money safety against single-party failure** — any two keys *can*
collude (e.g. `server+winner` draining the escrow), which degrades to the
unprotected baseline and is audit-visible.

## Money flows (all 2-of-3)

1. **Bid**: the bidder creates a P2PK bundle locked to `{seller, server, bidder}`,
   `n_sigs = 2`, `locktime = end + 7 days`, `refund = bidder`. The server verifies
   the lock structure, the mint (NUT-06/07/12) and records the proofs.
2. **Instant refund (outbid)**: bidder signature + server co-signature over the
   proof secrets → the bidder swaps the proofs back to themselves. No locktime wait.
3. **Claim → direct pay (default)**: seller signature + server co-signature →
   the server swaps the winner's proofs into `[seller net (1-of-1 P2PK,
   delivered in the claim response → wallet), operator fee, winner change]`.
   The winner-protected fulfillment escrow (§4–§6 of the v1 design) remains
   implemented but DORMANT behind the `escrowEnabled` deployment flag.
4. **Shipped**: seller clicks "Mark shipped" (Schnorr auth over `shipped:<id>`)
   — the server flips the boolean flag only; no funds move. Shipping details
   (address, tracking number) travel in private Nostr DMs, never through the
   platform.
5. **Winner confirm**: winner signs `confirm:<id>` plus every escrow proof
   secret → server verifies + co-signs → swap to 1-of-1 P2PK proofs for the
   seller (delivered via `pending_receives`, collected with
   `GET /wallet/receive`). Escrow row deleted only after the swap succeeds.
6. **Timeout resolution (party-triggered)**: after `created_at + 14 days`
     - shipped → seller may self-release (`release:<id>` + per-secret sigs)
       — the winner cannot prevent seller payment by staying silent;
     - not shipped → winner may self-refund (`refund:<id>` + per-secret sigs).
   Both swaps produce 1-of-1 P2PK outputs for the caller and delete the row.
   The lazy timeout pass in `settleIfDue` is observe-only: the server cannot
   sign a 2-of-3 spend alone, so it never moves or deletes escrowed funds by
   itself.
7. **Change return**: the excess (locked max − standing price) is a 1-of-1 P2PK
   output to the winner, collected via `GET /api/auctions/:id/change`.

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
- **Signature verification**: claim/refund/co-sign and every escrow resolution
  path verify Schnorr signatures over the proof secrets against the expected
  key (seller for claim/release, winner for refund/confirm). The party's
  per-secret signatures are what the mint checks — a witness fabricated from
  a public key can never verify, so resolution swaps are cryptographically
  bound to an entitled party. The `proofs_data` endpoints return P2PK-locked
  proofs — harmless to disclose, the effective gate is the co-sign check.
- **Post-swap persistence**: every code path that swaps at a mint (claim,
  confirm/release/refund) wraps everything after the swap in a guard: DB
  writes retry (5×, backoff) and — on total failure — a single CRITICAL log
  line carries every output proof set (or raw blindings + signatures) so the
  funds are always manually recoverable. A bare throw after a successful
  swap used to strand proceeds invisibly; that class of bug is now closed.
- **Pending-receive ack protocol**: `GET /wallet/receive` is read-only
  (rows carry rid); deletion happens only via signed
  `POST /wallet/receive/ack` listing receipts the client actually stored.
  A failed wallet write therefore leaves the payout on the server for retry
  instead of destroying it (clear-on-read used to do exactly that).
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
  and `1022` (escrow `shipped/confirmed/released/refunded`) never carry `secret`,
  `proof`, or `max`.
- **Rate limits** (`lib/rate-limit.ts`): bids 30/min, auction creation
  10/min, co-sign 20/min, claim-data/refund-data/escrow-read 30/min,
  shipped/confirm/release/refund 20/min.
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
   this project. A mint outage during the escrow window delays confirm/
   release/refund but loses nothing — the row (with the proof secrets) stays
   until a swap succeeds.
4. **Legacy data.** Bids created before the proof double-lock guard are not in
   `bid_proofs`; their proofs could in theory be re-submitted (NUT-07 would
   still catch already-spent ones). New bids are fully guarded. Escrows created
   by the superseded two-stage design are rebuilt to the v1 shape by migration
   0009 / the initDb shape repair (`shipped` resets to 0).
5. **Server key custody.** `SERVER_PRIVATE_KEY` is the server's co-signing key.
   If leaked, an attacker still cannot move funds alone (needs a second
   party), but they can grief (co-sign refunds of outbid bids they control,
   or refuse to co-sign). Protect it like any signing key.
6. **Fulfillment quality disputes are out of scope in v1.** The platform only
   knows a boolean `shipped` flag — it cannot verify that anything was
   actually sent or what it contained. "Arrived but fake" / "marked shipped
   but nothing sent" are handled off-platform via Nostr negotiation +
   permanent Nostr-link accountability; reputation and an arbiter registry
   are deferred to v2 (see the v1 design §11).
7. **Mint input fees can eat tiny proceeds.** The claim reserves the mint's
   NUT-02 input fee from the seller's net. On mints with a high
   `input_fee_ppk`, tiny auctions can net zero — the claim then completes
   with `degenerate: true`, no escrow, and empty `seller_proofs`. The client
   surfaces this instead of silently showing an empty wallet (the silent
   variant was a real bug: 2026-08-25 test10 incident, fixed by routing the
   fee through `coerceMintFee` — a NaN there used to skip escrow entirely).
8. **No moderation of Nostr/Blossom mirrors.** Relays and Blossom servers are
   third-party; listings there are eventually consistent and not moderated by
   this server. `DB` remains canonical for settlement.

## Deployment checklist

- `SERVER_PRIVATE_KEY` from a secure store (not committed; never in the repo;
  Cloudflare Worker: `wrangler secret put SERVER_PRIVATE_KEY`, not a `vars` entry)
- `AUCTION_FEE_BPS` set deliberately
- `NEXT_PUBLIC_BLOSSOM_URL` / `_FALLBACK` (`blossom.primal.net` / `cdn.nostrcheck.me` defaults)
- HTTPS in front of the API (TLS is mandatory for mint/bid/escrow traffic)
- SQLite backups (`data/auction.db`) — `proof_data` and `fulfillment_escrows.proofs_data`
  must be persisted (P2PK secrets needed for co-sign; escrow `proofs_data` is the
  only copy of the escrow secrets until funds move)
- D1 migrations applied (`wrangler d1 migrations apply egavel-db --remote`,
  fallback `wrangler d1 execute`); if the remote DB predates the v1 escrow,
  migration 0009 rebuilds the legacy table
- Run the test suite before upgrades; the settle/claim/escrow paths are the
  money paths (`pnpm --filter @egavel/server test` — 240 tests as of 2026-08-24)
