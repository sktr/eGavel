# A non-custodial auction on Cashu (2-of-3 P2PK)

This document explains how a marketplace-style auction can be built on Cashu
e-cash **without any party holding the funds in escrow**. It is the design
behind this repository, written for the Cashu community.

## The problem: auctions need escrow

In a classic auction site, the platform holds the bidder's money in escrow:
a winning bid must be guaranteed payable to the seller, and losing bidders
must get their money back. That escrow is **custodial** — users trust the
platform not to run off with the funds, and funds are frozen during the
auction.

Cashu e-cash offers a different primitive: **NUT-11 P2PK**. A token can be
locked to a public key with an `n_sigs` threshold. That alone gives escrow —
but a *single-key* lock still puts one party in control.

## The idea: 2-of-3 P2PK locks

Lock every bid token to **three keys** with `n_sigs = 2`:

```
data    = seller
pubkeys = [server, bidder]
n_sigs  = 2
locktime = auction_end + 7 days
refund  = bidder
```

No single party can spend the token. Every unlock needs a co-signature:

| Flow | Signers | Result |
|------|---------|--------|
| Bid | — (bidder locks) | proofs recorded as the bid |
| Outbid → refund | bidder + server | losing bidder gets funds back **instantly** |
| Win → claim → escrow | seller + server | seller's proceeds enter two-stage escrow (see below) |
| Excess → change | (server swap) | winner gets back `max − standing price` |

The server **never holds the funds**. It only co-signs unlocks that the
protocol logic allows. If the server disappears, the funds are locked until
the locktime, then the bidder recovers via the refund key. The mint is the
only entity that ever holds e-cash.

### Why not a 2-of-2 lock?

A 2-of-2 lock (seller + server) works for claims, but outbid bidders would
have to wait for the locktime to recover their funds. Including the **bidder**
as the third key means an outbid bid can be refunded immediately via
bidder + server co-signature — which is a usability requirement for a real
auction.

## The flows

### 1. Bid

The bidder creates a P2PK bundle worth their **maximum** bid (see "Proxy
bidding" below) and submits it to the server. The server verifies:

- the P2PK structure (data == seller, pubkeys ⊇ {server, bidder}, `n_sigs == 2`,
  locktime ≥ end + 7 days, refund ⊇ bidder, `sigflag = SIG_INPUTS`)
- the mint: NUT-06 capabilities, best-effort NUT-12 DLEQ, **NUT-07 unspent**
- that the same proofs are not already locked by another bid (double-lock guard)

### 2. Outbid → instant refund

The engine raises the standing price when a higher max arrives. The losing
bid's proofs are still unspent; the bidder signs them, the server co-signs,
and the bidder swaps the proofs back to their own wallet. No locktime wait.

### 3. Claim (seller) → two-stage escrow + change (winner)

After settlement the seller signs the winning proofs and the server co-signs.
The server runs a **single swap** that splits the winner's locked bundle into:

```
[seller net → escrow, operator fee (AUCTION_FEE_BPS, defaults to 0), winner change]
```

`change = locked max − standing price` — the winner only ever pays the
standing price, and the excess comes back as a 1-of-1 P2PK output they sweep
into their wallet.

`seller net` does **not** go directly to the seller. It enters **Stage 1**
of the fulfillment escrow:

```
Stage 1: {seller, winner, server} n_sigs=2, locktime=claim+10 days, refund=winner
```

The seller cannot spend it alone — reporting a tracking number is a
cryptographic precondition for getting paid. If `seller_net == 0` (e.g. 100%
fee) no escrow is created and the settlement is instant. `ESCROW_MODE=legacy`
disables the escrow entirely.

### 4. Fulfillment — two-stage escrow (v1, no arbiter)

Shipping coordination (address, tracking sharing) stays in the user's own
Nostr DMs — the platform stores only the validated tracking number and
stage/status.

```
[claim]  seller+server → Stage 1 lock {seller,winner,server} refund winner @ +10d
[seller] label first: create label, POST /tracking BEFORE handing to carrier
         → server validates format (S10 check digit / UPS 1Z / FedEx 12|15 / DHL 10)
         → relock swap: Stage 1 in (seller + winner-or-server) → Stage 2 out
           {seller,winner,server} refund seller @ report+30d
         → only then hand parcel to carrier
[winner] receives item → POST /confirm-receipt (winner signs secrets)
         → server-mediated release swap → 1-of-1 P2PK to seller (via pending_receives)
```

| Stage | Lock | Refund | Protects |
|-------|------|--------|----------|
| **1** | `{seller,winner,server}` 2-of-3 | winner @ +10d | winner vs non-shipping seller |
| **2** | `{seller,winner,server}` 2-of-3 | seller @ +30d | seller vs silent winner |

- **Tracking validation** is format-only (S10 UPU check digit `weights [8,6,4,2,3,5,9,7]`,
  UPS `1Z…`, FedEx, DHL). Freshness checks are deferred.
- **Winner consent gate:** relock needs a second signature — normally the winner's.
  If the winner is silent for 72 h, the server may co-sign instead (mechanical
  validation only, recorded as `fallback_cosign` in the audit log). The winner's
  veto is effectively a 72-hour delay, not a crypto veto.
- **Deadline boundary:** `/tracking` is rejected within 24 h of `claim+10d`.
- **Relock fees** are reserved from the escrowed amount (seller bears them).
- **Any cooperative pair** (`seller+winner`, etc.) can unlock at any time (2-of-3).
- **Voluntary split:** `POST /escrow/split` with both parties' signatures executes
  any agreed division.

Timeouts without cooperation:

- No tracking by +10 d → winner sweeps alone (refund key, zero server involvement,
  proofs delivered via `GET /escrow`).
- Shipped but winner silent → seller sweeps alone after +30 d.
- Both ghost → winner is paid sooner.
- Dispute-free path costs only one extra mint swap (seller-borne).

Quality disputes ("arrived but fake") are out of scope in v1 — handled via
Nostr negotiation + voluntary split + permanent Nostr-link accountability.
A future arbiter registry (opt-in premium, `seller+winner+server+arbiter`
2-of-4) is designed but deferred.

### 5. NIP-99 marketplace mirror + Blossom images

Listings are mirrored to Nostr for **discovery**, without touching settlement
(which stays in `DB + mint`).

- **Blossom (NIP-B7):** the create page compresses images, then uploads via
  `BlossomClient` with `kind 24242` auth (`PUT /upload` to
  `blossom.primal.net`, fallback `cdn.nostrcheck.me`). The DB stores only
  URLs (60 bytes each); base64 inline is capped at 4 images / 2 MB.
- **NIP-99 (kind 30402):** after `POST /auctions` succeeds, the client
  publishes an addressable event `d=egavel-<id>` with tags
  `title`/`summary`/`price` (`buy_now ?? start_price` SAT)/`t`/`image`/`r`
  (egavel URL)/`published_at`/`expiration` (= `end_time`)/`reserve`/`buy_now`/`auction:start|end`.
  Edits re-publish the same `d`; deletion publishes kind `5`. `price` lets
  Shopstr-style clients render a fixed price, while custom tags let
  eGavel-aware clients render auction semantics. Publishing is client-signed
  (NIP-07 or pasted nsec) and fire-and-forget — failure never blocks the
  listing. The detail page shows `View on Nostr` (`naddr` → `nostr.at`).
- **Audit log (B):** the server fire-and-forgets kind `1021` (bid hash +
  standing price) and escrow transitions as `1021`/`1022` with `[status]`
  tags (`shipped` carries *kind* only, never the number). Third parties can
  recompute standing prices and follow the escrow lifecycle without trusting
  the server.

`DB` remains canonical for settlement; Nostr is a mirror. Display fields
(`images`, `title`) could later be dropped from `DB` without loss because
Blossom URLs live in both places.

## Proxy bidding (second price)

The bid amount is a **maximum**, not a price. The engine computes the standing
price from all bidders' maxes:

```
standing price = min(highest max, 2nd-highest max + min increment)
                (or the start price with a single bidder)
```

Because bidders lock their **full max** (fully collateralized), the winner's
excess must be returned — that's the `change` output above. Maxes are kept
server-side so nobody can snipe the leader with a `max+1` bid.

## Security properties

- **Money safety is cryptographic**: no single party can move funds alone; the
  server cannot run with the money. This holds for bids *and* escrow — every
  escrow release needs a second signature; the server alone unlocks nothing.
  Any two keys *can* collude (e.g. `server+winner` draining Stage 2), which
  degrades to the unprotected baseline and is audit-visible — money safety is
  against single-party failure; multi-party collusion and process fairness rest
  on OSS, self-hosting, and reputation (see `docs/security.md`).
- **Auction fairness is NOT**: the server decides which bids to accept and how
  to settle. That rests on OSS code, self-hosting, and operator reputation.
  The 72 h fallback for escrow is fairness-tier, not crypto-enforced.
  See [`docs/security.md`](./security.md) for the full threat model.

## What the protocol lacks (a NUT gap)

The one thing this design needs from the Cashu protocol is a way to **verify a
token's value without seeing it**. NUT-07 answers "is this Y spent?" but not
"what is this Y worth?" Today the server must see the proofs (custody during
verification) to check a bid's amount. This is the same gap motivating
[`cashubtc/nuts#265`](https://github.com/cashubtc/nuts/issues/265) (add amount
to the NUT-07 response). A mint-signed **balance attestation** would let any
third party (auction server, exchange counterparty, ...) verify a value
without custody — and remove the remaining "the server briefly holds the
proofs" step from this design.
