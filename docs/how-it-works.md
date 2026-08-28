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
| Win → claim → direct pay | seller + server | seller's proceeds land **directly in seller's wallet** (see §3) |
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

### 3. Claim (seller) → direct pay + change (winner)

After settlement the seller signs the winning proofs and the server co-signs.
The server runs a **single swap** that splits the winner's locked bundle into:

```
[seller net (1-of-1 P2PK → seller wallet), operator fee (AUCTION_FEE_BPS, defaults to 0), winner change]
```

`seller net` is delivered **directly** — the server mirrors the payout proofs
into `pending_receives` (returned as `pending_rid`) and the client stores them
in the wallet, then acks (`POST /wallet/receive/ack`); Fund Collection / the
30s auto-poll re-delivers until acked so a lost response never strands funds.
`change = locked max − standing price` — the winner only ever pays the
standing price, and the excess comes back as a 1-of-1 P2PK output they sweep
into their wallet (auto-collected). If `seller_net == 0` (e.g. 100% fee) the
claim still completes but the seller receives no proofs (`degenerate: true`).

> **Note:** a winner-protected fulfillment escrow (`{seller,winner,server}`
> 2-of-3, refund winner @ claim+14d) is implemented behind the
> `escrowEnabled` flag but **currently dormant** — see §4.

### 4. Fulfillment — escrow is currently **dormant** (kept for a future opt-in mode)

> **Current default:** direct pay (see §3). The simplified escrow below is
> **not active** — `escrowEnabled` is `false` and the EscrowPanel is
> unmounted. Code, migrations, and tests for it are retained.

When enabled, the winner-protected escrow would work as follows
(kept for reference, mirrors the implemented but dormant code):

Shipping coordination (address, tracking number) stays in the user's own
Nostr DMs — the platform would store only a boolean `shipped` flag.

```
[claim]   seller+server → escrow lock {seller,winner,server} refund winner @ +14d
[seller]  ships the lot, DMs tracking to the winner, clicks "Mark shipped"
          → shipped = true (no funds move)
[winner]  receives item → "Confirm receipt" (winner signs every proof secret)
          → swap → 1-of-1 P2PK proofs for the seller via pending_receives
[timeout] +14 days after claim:
            shipped    → seller clicks "Release payment" (release:<id>)
            !shipped   → winner clicks "Refund" (refund:<id>)
          both are party-signed swaps gated by the server on shipped+time;
          the server alone can never resolve a timeout
```

- **Why party-triggered:** non-custodial means the server holds one key of
  three — it cannot spend by itself, so timeout resolution is a signed
  request from an entitled party, not an automatic job.
- **Winner's cryptographic fallback:** after the locktime the winner's refund
  key can sweep the proofs regardless, so funds never strand.
- **Row safety:** the escrow row holds the only copy of the proof secrets and
  is deleted only after a successful swap; persistence retries and logs the
  payout proofs if the DB write fails post-swap.

Quality disputes ("arrived but fake") would remain out of scope even in
escrow mode — handled via Nostr negotiation + permanent Nostr-link
accountability. A future arbiter registry (opt-in premium,
`seller+winner+server+arbiter` 2-of-4) is designed but deferred.

### 5. NIP-99 marketplace mirror + Blossom images

Listings are mirrored to Nostr for **discovery**, without touching settlement
(which stays in `DB + mint`).

- **Blossom (NIP-B7):** the create page compresses images, then uploads via
  `BlossomClient` with `kind 24242` auth (`PUT /upload` to
  `blossom.primal.net`, fallback `cdn.nostrcheck.me`). The DB stores only
  URLs (60 bytes each); base64 inline is capped at 4 images / 2 MB.
- **NIP-99 (kind 30402):** the client generates `id = sellerPubkey-Date.now()`
  before `POST`, signs an addressable event `d=egavel-<id>` with tags
  `title`/`summary`/`price` (`buy_now ?? start_price` SAT)/`t`/`image`/`r`
  (egavel URL)/`published_at`/`expiration` (= `end_time`)/`reserve`/`buy_now`/`auction:start|end`,
  and sends `POST /auctions { id, ..., nostr_event }` in one round-trip. The
  server verifies `kind 30402`, `pubkey == linked Nostr pubkey`, `d`,
  signature and `created_at`, then saves and fire-and-forget publishes the
  same event to relays. If `30402` is missing/invalid the `POST` is rejected
  (`MISSING_NOSTR_EVENT` etc.) — no listing can exist without a valid NIP-99
  mirror, even via direct API. Edits re-publish the same `d`; deletion
  publishes kind `5`. The detail page shows `View on Nostr` (`naddr` →
  `nostr.at`) + `Copy naddr` only (no Republish).
- **Audit log (B):** the server fire-and-forgets kind `1021` (bid hash +
  standing price) and escrow transitions as `1022` with `[status]` tags
  (`shipped/confirmed/released/refunded`). Third parties can
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
  server cannot run with the money. This holds for bids and for the (currently
  dormant) escrow — every escrow release would need a second signature; the
  server alone unlocks nothing. Any two keys *can* collude (e.g. `server+winner`
  draining the escrow), which degrades to the unprotected baseline and is
  audit-visible — money safety is against single-party failure; multi-party
  collusion and process fairness rest on OSS, self-hosting, and reputation
  (see `docs/security.md`).
- **Auction fairness is NOT**: the server decides which bids to accept and how
  to settle. That rests on OSS code, self-hosting, and operator reputation.
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
