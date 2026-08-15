# Security & Threat Model

Cashu Auction is a **non-custodial** auction platform. The core security claim is:

> **The server can never move user funds alone.** Bids are locked as 2-of-3 P2PK
> e-cash proofs (seller + server + bidder keys, `n_sigs = 2`), and all fund
> movements require a co-signature from a second party.

This document describes the trust model, the money flows, and the known
limitations. It is written from the perspective of someone deploying or
auditing this software.

## Trust model

| Party  | Can do                                                           | Cannot do                                                          |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| Bidder | Lock a bid; instantly refund when outbid (with server co-sign)   | Spend another party's funds                                        |
| Seller | Claim the winner's proofs after settlement (with server co-sign) | Move funds alone                                                   |
| Server | Verify bids, pick the winner, co-sign claims/refunds             | Move funds alone (2-of-3 enforced cryptographically)               |
| Mint   | Hold and swap e-cash                                             | Steal proofs (bearer instruments, but see "Mint dependency" below) |

The server's honesty for **auction fairness** (did it accept my bid, did it
settle correctly?) is NOT cryptographically enforced. It rests on the OSS
code, self-hosting, and operator reputation. The non-custodial guarantee is
only about **money safety**.

## Money flows (all 2-of-3)

1. **Bid**: the bidder creates a P2PK bundle locked to `{seller, server, bidder}`,
   `n_sigs = 2`, `locktime = end + 7 days`, `refund = bidder`. The server verifies
   the lock structure, the mint (NUT-06/07/12) and records the proofs.
2. **Instant refund (outbid)**: bidder signature + server co-signature over the
   proof secrets → the bidder swaps the proofs back to themselves. No locktime wait.
3. **Claim**: seller signature + server co-signature → the server runs a swap
   that splits the winner's proofs into `[seller net, operator fee, winner change]`.
4. **Change return**: the excess (locked max − standing price) is a 1-of-1 P2PK
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
- **Signature verification**: claim/refund/co-sign paths verify Schnorr
  signatures over the proof secrets against the expected key (seller for
  claim, bidder for refund). The claimed-proof endpoints return proofs, but
  they are 2-of-3 locked and harmless to disclose — the effective auth gate is
  the co-sign signature check.
- **Winner contact (npub handoff)**: after settlement the winner's npub is
  shown to the seller; contact happens in the user's own Nostr client. The
  platform collects no shipping address.
- **Rate limits** (`lib/rate-limit.ts`): bids 30/min, auction creation
  10/min, co-sign 20/min, claim-data/refund-data 30/min.
- **Max secrecy**: the API exposes only the standing price; `max_amount`
  stays server-side (second-price incentive protection).

## Known limitations (honest)

1. **Auction fairness is not enforced.** A malicious operator can reject bids,
   settle incorrectly, or censor. This is inherent to a single-server
   auctioneer and is mitigated by OSS code, self-hosting, and reputation —
   not by the protocol.
2. **Server-signed attestations only.** Nothing here proves the actual
   on-mint movement of funds to a third party; proofs are not disclosed
   (privacy trade-off).
3. **Mint dependency.** If the mint disappears or refuses to serve, locked
   e-cash is stranded. This is a Cashu-ecosystem property, not specific to
   this project.
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
7. **No moderation/disputes.** Nothing prevents a seller from not shipping or
   sending fakes; the protocol cannot enforce real-world fulfillment.

## Deployment checklist

- `ALLOW_TEST_BIDS=0`
- `SERVER_PRIVATE_KEY` from a secure store (not committed; never in the repo)
- `AUCTION_FEE_BPS` set deliberately
- HTTPS in front of the API (TLS is mandatory for mint/bid traffic)
- SQLite backups (`data/auction.db`) — proof_data must be persisted
- Run the test suite before upgrades; the settle/claim/refund paths are the
  money paths
