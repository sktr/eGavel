# Cashu Auction Redesign Spec

Date: 2026-08-11
Status: accepted (design approved; implementation is based on this spec)

> **Status note (2026-08-12):** since this spec was written, the project has
> changed in two ways. (1) **Proxy bidding (second-price)** was implemented:
> `Bid` carries `max_amount` (locked proofs) and `current_amount` (standing
> price computed by the engine), and the winner's excess collateral is
> returned as a change output during the claim swap. (2) **The Nostr layer
> was removed** ("de-Nostr"): listings are created via `POST /api/auctions`,
> shipping is authenticated with a Schnorr-signed payload, and the audit
> events described in §3 are no longer published. See `ROADMAP.md` and
> `.superpowers/sdd/HANDOFF.md` for the current state.

---

## 1. Background and Problems

The Phase 1 implementation of the Cashu × Nostr decentralized auction is complete, but the design review surfaced the following problems.

### 1.1 The trust model diverged from the design intent and the protocol

The old design (ADR-0001/0002) claimed "Trustless by design — escrow handled by protocol", but this conflicted with the actual semantics of NUT-11 (P2PK):

- Under NUT-11, the `data` key (= the seller) can **spend immediately, even before the locktime**. The locktime does not delay the seller's payment.
- The `refund` key can spend **only after the locktime has elapsed**. The old design's "early release of self-overbid via server co-sign" only works if the server key is in the refund list.
- As a result, bidder fund protection depended on operational behavior ("the server does not show Proofs to the seller") rather than a protocol guarantee.
- Moreover, the implementation persists `proof_data` (secret + C = the complete spending path) in the DB, contradicting ADR-0001's "the server does not hold Proofs".

### 1.2 The economic backing of amounts is not guaranteed

- A bidder can stand up their own Cashu mint and issue arbitrary amounts. The server only checks NUT-07's UNSPENT status.
- If a mint does not support P2PK (NUT-11), then per the NUT-11 spec the Proof is **treated as spendable by anyone** (the lock is meaningless).
- `parseAuctionEvent` drops `mint_url` / `reserve_price` from the event, so bidding on the mint specified by the seller is not enforced.

### 1.3 Settlement timing is non-deterministic

- verifyBid accepts bids until `end_time + 30s`, while the scheduler (60s interval) settles when `now >= end_time`.
- Depending on whether the tick ran first, whether a bid within the grace period is accepted becomes a race condition.

### 1.4 The winner → seller flow contradicts the implementation

- ADR-0002 specifies "the winning bidder DM-sends the P2PK token to the seller on their own timing", but the frontend's `sendP2PK` does not keep sent Proofs in the wallet (only `result.keep` is stored). Since no Proof remains with the winner, this flow is not executable.

### 1.5 A critical implementation vulnerability

- `POST /api/bids` is unauthenticated, and simply passing `mint_url: "test://local"` lets anyone bypass the NUT-07 check entirely.

### 1.6 The UI shows unimplemented features

- Reserve price, buy-now, fees, deposits, watchlist, image upload, and checkout exist in the UI but are not implemented.

---

## 2. Trust model (2-of-3 P2PK)

### 2.1 Approach

The "Trustless" claim is withdrawn and the following is defined as the honest model:

> **The operating server is a non-custodial intermediary that validates bids, determines the winner, and co-signs claims/refunds. Users hold their own keys. Funds are protected at the protocol level by a 2-of-3 lock: "no funds can be spent without 2 signatures among the seller, server, and bidder's 3 keys."**
>
> **With 2-of-3, a bidder can recover their funds immediately (via co-sign with the server) the moment they are outbid. This is a usability requirement for an auction and resolves the 2-of-2 "funds locked until the locktime" limitation.**

### 2.2 P2PK secret structure

Bid Proofs are locked with the following P2PK secret:

```jsonc
["P2PK", {
  "nonce": "<random>",
  "data": "<seller_pubkey>",
  "tags": [
    ["pubkeys", "<server_pubkey>", "<bidder_pubkey>"],
    ["n_sigs", "2"],
    ["locktime", "<end_time_ms + 24h converted to seconds>"],
    ["refund", "<bidder_pubkey>"]
  ]
}]
```

Meaning:

- Key set = **2-of-3** of `{data: seller, pubkeys: [server, bidder]}`: no funds can be spent without 2 signatures among the 3 keys. No one can move the funds alone.
- There are 2 spending paths:
  - **Claim**: seller + server (collects the winner Proof after settlement. Includes fee splitting, §6.2)
  - **Outbid refund**: bidder + server (immediate recovery the moment the bid is no longer the highest, §6.4)
- `refund` (bidder) can spend alone after the locktime elapses → **insurance against server downtime** (recovery after end+24h).
- The server key is the same as the `NOSTR_PRIVATE_KEY` env var (shared for signing and co-signing).
- `sigflag` is not specified (default SIG_INPUTS). The signature target when spending is only the "secret string of the input", so no aggregated message construction like SIG_ALL is needed. Claims are made with both parties' signatures on this secret (§6).

### 2.3 Signature path selection

- **Claim**: seller + server signature (§6.2)
- **Outbid refund**: bidder + server signature (§6.4) — no locktime needed
- **Insurance (after locktime)**: bidder's refund key alone (recovery during server downtime)

As an intermediary, the server decides "which paths co-signing is allowed on": claims are for SETTLED + winner, refunds are for "the bid is no longer the current highest".

---

## 3. Events and Data Schema

### 3.1 kind:39000 (Auction) — content extension

```jsonc
{
  "item": "string",
  "description": "string",
  "start_price": 1000,          // sat, required
  "reserve_price": 5000,        // sat, optional (unset = none)
  "buy_now_price": 10000,       // sat, optional (unset = none)
  "end_time": 1730000000000,    // milliseconds
  "mint_url": "https://mint.cashu.space",  // required: only bids on this mint are accepted
  "category": "watches",        // optional
  "condition": "New & Unused",  // optional
  "shipping": "home delivery",  // optional
  "image": "url"                // optional (first image)
}
```

tags: `[["d", "<auction_id>"]]` (as before)

### 3.2 kind:39001 (Bid) — unchanged

```jsonc
{
  "kind": 39001,
  "tags": [
    ["a", "39000:<seller_pubkey>:<auction_id>"],
    ["p", "<bidder_npub>"],
    ["Y", "<hash_to_curve_value>"]
  ],
  "content": "{\"amount\":<sat>,\"received_at\":<unix_ms>}"
}
```

### 3.3 kind:39003 (Settlement) — add `result`

```jsonc
{
  "kind": 39003,
  "tags": [
    ["a", "39000:<seller_pubkey>:<auction_id>"],
    ["p", "<winner_npub>"],             // omitted if there is no winner
    ["winner_amount", "<winning_sat>"], // "0" if there is no winner
    ["result", "sold" | "reserve_not_met" | "no_bids"]
  ],
  "content": "{\"bids_checked\":<int>,\"settled_at\":<unix_ms>}"
}
```

### 3.4 Shared types (@cashu-auction/shared)

```ts
export interface Auction {
  id: string
  item: string
  description: string
  start_price: number
  reserve_price: number | null
  buy_now_price: number | null
  end_time: number            // ms
  seller_pubkey: string
  state: AuctionState
  start_time: number          // ms
  last_extended_at: number | null
  winner_npub: string | null
  winning_amount: number | null
  mint_url: string
  category?: string
  condition?: string
  shipping?: string
  image?: string
}
```

### 3.5 DB migration

Add columns to the `auctions` table:

- `mint_url TEXT NOT NULL DEFAULT ''`
- `reserve_price INTEGER`
- `buy_now_price INTEGER`
- `category TEXT`, `condition TEXT`, `shipping TEXT`, `image TEXT` (optional)

---

## 4. Bid Validation Flow

Both `POST /api/bids` (HTTP) and NIP-17 DM go through `processBid` → `verifyBid` (as before).

### 4.1 Validation items (verifyBid)

1. The auction is ACTIVE or EXTENDED
2. `Date.now() <= end_time + 30s` (grace period, consistent with §5)
3. `payload.amount >= auction.start_price`
4. `payload.amount > the current highest bid`
5. `payload.proof.amount == payload.amount`
6. Parse the P2PK secret:
   - `data` matches `auction.seller_pubkey` (compared in x-only canonical form. Normalize with cashu-ts's `dedupeP2PKPubkeys`, etc.)
   - `pubkeys` contains the server key **and `payload.bidder_pubkey`** (2-of-3)
   - `n_sigs == 2`
   - `sigflag` is unset or `SIG_INPUTS` (SIG_ALL is rejected because it is inconsistent with the claim flow)
   - `locktime >= ceil((end_time + 24h) / 1000)`
   - `refund` contains `payload.bidder_pubkey`
7. `payload.mint_url == auction.mint_url` (**new**)
8. mint NUT-06 check (**new**): `/v1/info` must support NUT-11, NUT-07, NUT-08, NUT-10. Results are cached in memory (TTL 1h)
9. NUT-07: Y is UNSPENT. In addition to `Ys`, include `proofs` in the request if the mint supports it (best effort)
10. **Best effort**: if the Proof includes a NUT-12 DLEQ, verify it against the mint's keyset (NUT-02). Successful verification proves the Proof was issued by the mint

### 4.2 test-mode bypass

Skipping validation for `mint_url === "test://local"` is **only allowed when the `ALLOW_TEST_BIDS=1` env var is set** (default OFF). If unset, it is rejected as a mint_url mismatch.

### 4.4 Limitations of the economic backing of amounts (documented)

- NUT-07's UNSPENT only means "unused"; it does not prove "a valid Proof issued by the mint".
- Fabricated Proofs with random `C` values can pass validation. This materializes when the mint rejects the swap at the winner's claim time (a bidder can win without paying = a griefing attack against the seller).
- The countermeasures are mint-dependent: NUT-07 `proofs` support / NUT-12 DLEQ verification (§4.1 items 9-10).
- A complete solution (a balance certificate of mint issuance) is a Phase 3 consideration.

### 4.3 per-auction lock

Bid processing and settlement are serialized with an in-process Mutex keyed by the auction ID. Both `processBid` and `scheduler.tick` acquire the lock before reading/writing the DB.

---

## 5. State Transitions and Settlement Timing

### 5.1 State machine

```
ACTIVE / EXTENDED --(now >= end_time + 30s detected on first tick, and no extension condition)--> SETTLED
ACTIVE / EXTENDED --(a bid with E-5min <= received_at <= E exists)------> EXTENDED (end_time += 5min)
ACTIVE / EXTENDED --(a bid with amount >= buy_now_price accepted)--------> SETTLED (immediate)
```

### 5.2 Deterministic grace approach

- Settlement is finalized at the first tick that satisfies `now >= end_time + GRACE(30s)`.
- Bids arriving during the grace period (E~E+30s) are accepted but **do not extend** (only bids with `E-5min <= received_at <= E` count for extension).
- The UI (detail screen) states "Bids sent by the end time are accepted until E+30s".
- Settlement delay due to the 60s tick granularity (up to ~90s) is accepted, and once decided, the settlement **result** is immutable.

### 5.3 Reserve price

- If `reserve_price` is set, there is no sale unless `winning_amount >= reserve_price`.
- If the reserve is not met, publish a settlement with `result: "reserve_not_met"` and `winner_npub = null`.

### 5.4 Buy-now

- If `buy_now_price` is set and the current highest < `buy_now_price`, accepting a bid with `amount >= buy_now_price` **settles immediately** (skipping extension and the grace period).
- Winner amount = the bid amount. The UI's Buy Now button submits exactly `buy_now_price`.
- If the current highest >= `buy_now_price`, Buy Now is disabled (already bid at or above the buy-now amount).

---

## 6. Claim Flow (server-driven + co-sign)

### 6.1 Prerequisites

- Under NUT-11's SIG_INPUTS, the spending signature of an input Proof is a Schnorr signature on the "secret string of the input" (or on an aggregated message under SIG_ALL).
- Because it is 2-of-2, spending the winner Proof requires **signatures from both the seller and the server**.
- NIP-07 cannot sign arbitrary messages, so **claims are made with a key that can sign arbitrary messages (in-app wallet key / localStorage)**. Claims for NIP-07 users are not supported in Phase 1 (documented as a limitation).

### 6.2 Flow

1. The seller presses Claim in the dashboard.
2. `GET /api/auctions/:id/claim-data?seller_pubkey=<pk>` → validates the conditions (SETTLED, has a winner, claimant == seller) and returns the winner Proof's `proof_data`. The seller_pubkey is self-declared, but even if the proof leaks, it is 2-of-2 so **it cannot be spent without the seller's signature**. The effective authentication gate is the co-sign at step 4 (signature verification).
3. The seller wallet generates blinded outputs for new Proofs (single seller signature, no locktime) and builds the swap. Under SIG_INPUTS, the signature target is **the winner Proof's secret string itself**. Sign the secret with the seller key to obtain `seller_sig`.
4. `POST /api/auctions/:id/co-sign` receives `{ secret, seller_sig }`. The server verifies:
   - The auction is SETTLED and has a winner
   - claimant == `auction.seller_pubkey`
   - `secret` **exactly matches** the winner Proof's secret
   - `seller_sig` is a valid Schnorr signature on `secret` by `seller_pubkey`
   - **`now < locktime`** (after the locktime, the bidder's refund key becomes valid, so co-signing is refused)
   and returns `server_sig`, the signature on `secret` with the server key.
5. The seller wallet attaches the 2 signatures `seller_sig` + `server_sig` to the winner Proof's witness, includes it in the inputs, sends the swap directly to the mint together with the outputs, and saves the received new Proofs in the wallet.

- The server only sees the blinded messages of the outputs; it never sees the new Proofs.
- co-sign is idempotent (re-signing the same secret is always valid). Double withdrawal is impossible because the token itself is single-use at the mint.
- Adopting SIG_INPUTS removes the need for cashu-ts's unpublished SIG_ALL message construction.

### 6.3 Error conditions

- NOT_SETTLED / NO_WINNER / NOT_SELLER / INVALID_SIGNATURE / INVALID_MSG / CLAIM_EXPIRED (now >= locktime)

### 6.4 Bidder refund (immediate outbid refund)

**The core 2-of-3 feature**: once a bidder is outbid, that bid's funds are **refunded immediately** (without waiting for the locktime).

- The frontend does not keep sent Proofs, so the server returns the proof_data it holds:
  1. `GET /api/bids/:id/refund-data?bidder_pubkey=<pk>` → validates the conditions (`bidder_pubkey` matches the refund key, the bid is no longer the current highest) and returns the bidder's own proof_data
  2. The bidder wallet signs each secret with the **bidder key** and requests a co-sign via `POST /api/bids/:id/refund-co-sign` (the server re-verifies "the bid is outbid" and signs)
  3. The bidder wallet attaches both signatures to the witness and sends the swap to the mint → funds recovered
- **Automatic execution**: when polling on the dashboard/detail screen detects "my bid became outbid", the client automatically runs the refund (no user action needed).
- **State transitions**: `verified` (current highest) → `outbid` (no longer highest, refundable) → `refunded` (refund complete). An old bid from the same bidder outbid by their own new bid is also treated as `outbid`.
- **Idempotency**: because Proofs are single-use at the mint, the mint rejects double swaps.
- **Insurance**: even if the server is down and cannot co-sign, recovery is possible with only the bidder's refund key after the locktime (end+24h) (refund tag, single signature).
- NIP-07 users cannot sign arbitrary messages, so this is not supported in Phase 1 (same constraint as claims, §6.1).

---

## 7. New Features

### 7.1 Reserve price (listing & UI)

- Listing form: the existing "Buy Now Price" field actually writes `reserve_price` (bound to the `reservePrice` state in `create/page.tsx`). Re-label this **correctly as "Reserve Price"** and add a new "Buy Now Price" input field (`buy_now_price`).
- Events already published with `reserve_price` are interpreted as reserve as-is (no meaning change).
- Add "Reserve met / Reserve not met" badges to the list and past cards (already defined in the mqrzma5i design).
- Display the reserve status on the detail screen.

### 7.2 Buy-now (UI)

- Buy Now button on the detail screen. Display conditions: `buy_now_price` is set, current highest < `buy_now_price`, and the auction is running.
- On press, submit it as a bid of exactly `buy_now_price` (2-of-2 Proof generation is the same as a normal bid).

### 7.3 Watchlist

- Client-only: store a Set of `auction_ids` in localStorage.
- Enable the "♡ Add to Watchlist" button (toggle) on the detail screen.
- Add a "Watching" tab to the dashboard.

### 7.4 Checkout (shipping address)

- The winner registers a shipping address via `POST /api/auctions/:id/shipping`. The signature is in the form of a Nostr event (**kind:39004 Shipping**):
  - content: `{"auction_id": "...", "address": "...", "note": "..."}`
  - The event is signed with the winner's key, and the server verifies the signature to confirm the winner's identity (NIP-07 compatible). Replay protection is guaranteed by the uniqueness of `auction_id` + `created_at`
- The seller can view it in the dashboard's winning-bids list.
- In Phase 1 the address is visible to the server (documented). Future: direct shipping via NIP-17 DM.

### 7.5 Claim UI

- Seller dashboard: a Claim button for SETTLED auctions with a winner → executes the §6 flow.
- After the claim completes, the winning amount is reflected in the wallet balance.

### 7.6 Fees and deposits

- The UI currently shows "5% listing fee" and "Deposit 5,000 sats (refundable)", but these are **not implemented**. Remove them from the UI and move them to a future phase (§10).

---

## 8. Error Handling

### 8.1 verifyBid error codes (additions)

- `MINT_URL_MISMATCH`: `payload.mint_url != auction.mint_url`
- `MINT_UNSUPPORTED`: NUT-06 shows any of NUT-11/07/08/10 is unsupported
- `MINT_UNREACHABLE`: NUT-06 fetch failed (timeout, etc.)
- `P2PK_STRUCTURE_INVALID`: pubkeys / n_sigs do not match expectations
- `SERVER_KEY_MISMATCH`: the server key is missing from pubkeys

### 8.2 co-sign error codes

- `NOT_SETTLED` / `NO_WINNER` / `NOT_SELLER` / `INVALID_SIGNATURE` / `INVALID_MSG`

### 8.3 Common

- All errors return JSON as `{ error: string }` (as before).
- Client-caused errors (validation failures, invalid input) return 4xx; server-internal errors return 500.
- Introduce rate limiting per IP/key as spam protection for unauthenticated endpoints (POST /api/bids, co-sign, claim-data, refund-data).

---

## 9. Test Plan

### 9.1 Server unit tests

- **verify**: 2-of-2 structure (pubkeys, n_sigs), mint_url mismatch, NUT-06-unsupported mint, test-mode gate (reject if ALLOW_TEST_BIDS is unset)
- **parseAuctionEvent**: parsing of the new fields (mint_url / reserve_price / buy_now_price / category / condition / shipping / image)
- **scheduler**:
  - Does not settle before E+30s
  - Bids within the grace period (E~E+30s) are accepted and do not extend
  - Bids within E-5min extend the auction
  - Reserve not met yields `result: "reserve_not_met"` + winner null
  - Buy-now instant settlement (skips extension and grace)
- **processBid**: serialization under the per-auction lock, idempotency of duplicate bids
- **co-sign**: signature verification, rejection of claims by non-winners, rejection when not SETTLED, exact secret match, **rejection after the locktime (CLAIM_EXPIRED)**
- **refund-data**: rejection before the locktime, rejection when `bidder_pubkey` does not match

### 9.1 Additional: real-mint E2E

- Confirm on testnut.cashu.space, etc., that the whole chain **2-of-2 bid → settle → co-sign → seller swap → recovery** works.
- Given NUT-11 implementation differences (strictness varies per mint), pin the NUT-11 version under test and pre-verify against the target mint.

### 9.2 Web

- Watchlist: toggle, persistence, dashboard display
- Buy Now button: display conditions, disable conditions
- Checkout: only the winner can register, seller can view
- Claim flow: only the seller can claim, balance reflection on success

### 9.3 Migration

- The existing DB (`data/auction.db`) starts up with the new schema (idempotency of column additions)

---

## 10. Phase Plan

### Phase 2 (implementation scope of this spec)

1. Documentation cleanup (§11)
2. Shared types and DB migration
3. New verify validation items + test-mode gate
4. Scheduler grace / buy-now / reserve
5. per-auction lock
6. co-sign / claim-data / refund-data endpoints (with locktime checks)
7. Rate limiting (unauthenticated endpoints)
8. Frontend: 2-of-2 bidding, reserve / buy-now / watchlist / checkout / claim & refund UI
9. Remove the fee and deposit display, replace the dashboard's "Copy Proof"
10. Disable bidding on legacy auctions (mint_url='') (legacy display)

### Phase 3 (future, documented only)

- NUT-14 HTLC payment guarantees (since payment is already complete at bid time, effectively a reputation / escrow layer for "seller shipping guarantee and dispute resolution")
- Seller reputation & reviews, dispute resolution
- Real image upload (NIP-94 / Nostr file storage)
- Consensus across multiple server instances
- NIP-07 support for claims (requires a wallet extension providing arbitrary-message signing)

---

## 11. Documentation Cleanup

- Delete `docs/adr/` (0001/0002 contents are consolidated into this spec)
- Update `docs/agents/domain.md` (remove references to the ADRs and reference this spec)
- **Merge** `DESIGN.md` and `mqrzma5i-DESIGN.md` into **a single file** (correct to green-teal / the current accent to match the real UI). Visual design moves to `docs/ui/design.md`
- `CONTEXT.md`: add the following to the glossary
  - **Reserve Price**: the minimum amount required for a sale to close (no sale if not met)
  - **Buy Now**: the buy-now price. A bid at or above this amount closes the auction immediately
  - **Claim**: the process by which the seller recovers the winner Proof. Requires co-signing with the server because it is 2-of-2
  - **Co-sign**: the server's joint signature at claim time
  - **Grace Window**: the bid-acceptance grace period of E+30s after the end time E
- `AGENTS.md`: update the documentation structure description to this structure
- Replace the dashboard's "Copy Proof" button (currently the de-facto claim flow) with the co-sign flow

---

## 12. Decisions and Alternatives (consolidated from the old ADRs)

### 12.1 Adopting 2-of-2 P2PK

**Decision**: lock bid Proofs with `data=seller, pubkeys=[server], n_sigs=2` (2-of-2).

**Alternatives**:
- Status quo (single-signature seller) + honest description: no implementation change, but zero protection of bidders from seller malice
- `data=server`: rejected because the server could withdraw all bids on its own

### 12.2 Mint constraints

**Decision**: enforce mint_url + NUT-06 check. No allowlist (fully open).

**Alternatives**:
- Allowlist (env config): becomes operational curation, but conflicts with the decentralization claim. Add it if the need arises
- Unverified amounts (relying on social pressure): rejected because a 1sat bid could lie about 1 million sats

### 12.3 Handover of the winner Proof

**Decision**: server-driven (the server holds proof_data and assists the seller's claim via co-sign).

**Alternatives**:
- Winner transfer (ADR-0002's original intent): rejected because it depends on the winner's cooperation. It has the merit that the server holds no Proofs at all, but if the winner disappears the seller cannot recover
- Escrow (server holds the funds): rejected because it breaks non-custodiality

### 12.4 Settlement timing

**Decision**: deterministic grace approach (settle at the first tick at E+30s, no extension for bids in the grace period, per-auction lock).

**Alternatives**:
- No grace period (finalize at E): simple, but relay delays can invalidate bids
- Status quo + lock only: non-determinism remains

### 12.5 Signature scheme (adopting SIG_INPUTS)

**Decision**: leave sigflag unset and use the default SIG_INPUTS, limiting the co-sign signature target to "the winner Proof's secret string".

**Alternatives**:
- SIG_ALL (aggregated message): can include outputs in the signature target and is robust, but cashu-ts has no published message-construction function and strictness differs per mint implementation. Hand-rolled serialization is error-prone, so it is not adopted in Phase 2

### 12.6 Handling fabricated Proofs (best effort)

**Decision**: do NUT-07 `proofs` support and NUT-12 DLEQ verification on a best-effort basis and document the residual risk for unsupported mints. A complete solution (balance certificate) is Phase 3.

**Reason**: with standard NUTs alone, the means to verify "whether the Proof was issued by the mint" is mint-implementation-dependent. Making DLEQ mandatory would narrow the Phase 2 market to only the mints that support it.

### 12.7 Fees and deposits

**Decision**: do not implement in Phase 2; remove from the UI.

**Reason**: fee collection requires a new fund flow orthogonal to the bidding flow (e.g., separating the fee Proof) and would bloat scope.

---

## 13. MVP Revision (2-of-3, fees, commercialization policy)

### 13.1 Decisions

- **2-of-3 P2PK** (§2 revision): enables immediate outbid refunds. A usability requirement for an auction.
- **Seller-paid fees**: split the winner Proof's swap outputs into `[seller share, operator share]` at claim time.
  - The fee rate comes from env (`AUCTION_FEE_BPS`, default 500 = 5%)
  - `operator_share = floor(winning_amount * fee_bps / 10000)`, `seller_share = total - operator_share`
  - Since the claim is server-driven (§6.2), the server constructs the output split. Show "seller receives / fee" explicitly in the UI for transparency
- **Bid.status**: 3 states: `verified` / `outbid` / `refunded` (the old `replaced` is unified into `outbid`).
- **Business policy**: hosted marketplace + closed operation (private repo). Only the protocol spec (this spec) is public. Decide on open-sourcing after traction.
- **MVP scope**: digital-goods-focused, single host, dispute resolution/reputation deferred to the future.

### 13.2 Changed parts

- verify: server key + bidder key in `pubkeys` (§4.1 item 6)
- process-bid: when a new bid is accepted, transition "existing bids no longer the highest" to `outbid` (trigger for immediate refund)
- Claim: split outputs between seller and operator (fee)
- Refund: add a new `refund-co-sign` endpoint (outbid determination + server signature)
- Client: `pubkeys: [server, bidder]` in P2PK generation, automatic outbid refund
