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

## The idea: 2-of-3 P2KP locks

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
| Win → claim | seller + server | seller receives proceeds (no platform fee) |
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

### 3. Claim (seller) + change (winner)

After settlement the seller signs the winning proofs and the server co-signs.
The server runs a **single swap** that splits the winner's locked bundle into:

```
[seller net, operator fee (AUCTION_FEE_BPS, defaults to 0 — the public
instance charges no platform fee), winner change]
```

`change = locked max − standing price` — the winner only ever pays the
standing price, and the excess comes back as a 1-of-1 P2PK output they sweep
into their wallet.

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

- **Money safety is cryptographic**: no party can move funds alone; the server
  cannot run with the money.
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
