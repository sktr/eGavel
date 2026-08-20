# Non-custodial auctions on Cashu: escrow without a custodian

*Published: 2026-08-20 · [eGavel](https://github.com/sktr/eGavel) · live demo: <https://egavel.vercel.app>*

Auctions have an escrow problem. The bidder's money has to be guaranteed
payable to the seller if they win, and returned if they lose — and somebody
has to hold that money while the auction runs. On a classic auction site that
somebody is the platform, and trusting the platform with your money is exactly
the kind of trust Bitcoin was supposed to remove.

Cashu e-cash gives us a primitive that makes a different design possible:
**NUT-11 P2PK locks**. A token can be locked so that spending it requires
signatures from several keys — and that lets us build an auction where *no
party ever holds the funds in escrow*. The server runs the marketplace but
can never move a single satoshi alone.

This article walks through how eGavel (MIT-licensed, built on Cashu
e-cash) does it: a 2-of-3 P2PK lock, second-price proxy bidding, and a Nostr
identity layer that makes a permissionless marketplace accountable.

## The lock: 2-of-3 P2PK, not 2-of-2

The core idea is to lock every bid token to **three keys with an
`n_sigs = 2` threshold**:

```
data    = seller
pubkeys = [server, bidder]
n_sigs  = 2
locktime = auction end + 7 days
refund  = bidder
```

Three parties are involved — bidder, server, seller — and no single one of
them can spend the token. Every movement of funds requires a co-signature:

| Flow                    | Signers           | Result                                        |
|-------------------------|-------------------|-----------------------------------------------|
| Bid                     | — (bidder locks)  | proofs recorded as the bid                    |
| Outbid → refund         | bidder + server   | losing bidder gets funds back **instantly**   |
| Win → claim             | seller + server   | seller receives proceeds                      |
| Excess → change         | server (swap)     | winner gets back `max − standing price`       |

The two keys that matter for escrow are the **bidder** and the **seller**.
The server is in the middle purely as the protocol enforcer: it only co-signs
unlocks that the auction logic allows. If the server tries to run off with the
money, it can't — it needs either the bidder (refund) or the seller (claim)
to sign alongside it, and neither has a reason to.

Why 2-of-3 instead of the seemingly simpler 2-of-2 (seller + server)? Because
of the losing bidders. With a 2-of-2 lock, an outbid bidder would have to wait
out the locktime to recover their funds. Adding the bidder as the third key
means an outbid bid can be refunded **immediately** via bidder + server
co-signature — a hard usability requirement for a real auction.

The 7-day locktime and `refund = bidder` key are the safety net: if the server
disappears mid-auction, funds sit locked for 7 days, then the bidder sweeps
them back with their own refund key. The worst case is a delay, never a loss.

The server validates every lock it accepts: the P2PK structure (`data` must
be the seller, `pubkeys` must contain server and bidder, `n_sigs == 2`,
thresholds, SIG_INPUTS flag), the mint (NUT-06 capabilities, NUT-07 unspent
check), and that the same proofs aren't backing two different bids.

## Proxy bidding: the bid amount is a maximum

The bid amount is a **maximum**, not a price. Money isn't spent in increments
as you're outbid — bidders lock their full max at once (fully collateralized),
and the engine computes the standing price from everyone's maxes:

```
standing price = min(highest max, 2nd-highest max + min increment)
              (or the start price with a single bidder)
```

The winner is the bidder with the highest max (ties to the earlier bidder),
and they pay only the **standing price** — not their max. The gap
`max − standing price` comes back as change. This is a second-price auction
(Vickrey-style): bidding your true valuation is the dominant strategy, and
there's no incentive to snipe with a "max + 1" bid.

Privacy on top: maxes are kept server-side. The public API exposes only the
standing price — nobody can see how much headroom the leader has reserved.

## Settlement: one swap, three outputs

After the auction ends, the server co-signs the seller's claim and runs a
**single mint swap** that splits the winner's locked bundle into:

```
[seller net, operator fee, winner change]
```

The operator fee is `AUCTION_FEE_BPS`, an env-overridable mechanism that
**defaults to 0** — the public instance charges no platform fee at all. The
change output (excess above the standing price) is a 1-of-1 P2PK output
addressed to the winner.

Anti-sniping is handled at bid time: a bid in the last 5 minutes extends the
auction by 5 more minutes. Settlement is lazy (triggered on first read after
`end + 30s`), and a standing price that doesn't meet the reserve produces no
winner — no claim, no exchange of funds.

## Nostr as identity: making a permissionless market accountable

The 2-of-3 lock solves money safety, but an auction marketplace has a second
problem: **accountability**. Anyone can generate a key pair and list "a brand
new BMW" on a fresh account. Without identity, a scammer lists, takes the
money, and vanishes — and there's nothing tying that account to a persistent
reputation.

eGavel uses Nostr as its identity layer. A seller (and a bidder) links their
**trading key** — the key that signs bids and claims — to a **Nostr key** via
a signed **NIP-98 event** whose content is the trading pubkey. The server
verifies the event signature (NIP-01 canonical serialization, Schnorr) and
stores the binding `trading_pubkey ↔ nostr_pubkey`.

Two properties of this design are deliberate:

**The link is permanent.** Once bound, a trading key cannot be unlinked or
re-bound to a different Nostr key (`ALREADY_LINKED`). That's an
attack-resistance decision: if unlinking were allowed, a fraudster who rips
someone off could simply erase the Nostr trail that ties the bad trade to
their public identity. Permanent means reputation accumulates — you can't
start over.

**It's required to participate.** Creating an auction (`LINK_REQUIRED`) and
bidding both need a link. There's no anonymous spam account in eGavel; to
transact you must stake a persistent identity.

One Nostr key may back many trading keys — fine, because the trading key
carries no reputation; all accountability flows through the Nostr identity.

### Winner anonymity (and why it still works)

Because identity and money keys are separate, the winner can (and does) stay
**anonymous publicly** — the auction page shows `Winner — anonymous`, and the
public API never exposes the winner's npub. Only after settlement, and only
to the seller (and to the winner themselves), is the linked npub revealed —
via a Schnorr-signed read (`winner-view:<id>`), so an impersonator can't
scrape it. The seller can then verify that an inbound Nostr DM comes from the
genuine winner. Contact happens in the user's **own Nostr client** — nostr.at
or any relay they choose. The platform collects no email, no shipping address,
no personal data at all.

The NIP-98 binding means the platform doesn't own the identity — Nostr does.
Accounts are portable by construction: shut down the platform and the
identities (and the money, minus in-flight 7-day locks) survive.

## Security properties — honest limits

What's cryptographically guaranteed:

- **Money safety.** No party can move funds alone. The server cannot run with
  the money; worst case it can delay (7-day locktime) but never steal.

What is **not** guaranteed, and must be stated plainly:

- **Auction fairness.** The server decides which bids to accept and how to
  settle. This rests on open-source code, self-hosting, and operator
  reputation — not on the protocol.
- **Mint dependency.** The mint is the only entity that ever holds e-cash. If
  a mint disappears, locked funds are stranded until its keys sign. That's a
  Cashu ecosystem property.
- **Real-world fulfillment.** Nothing stops a seller from not shipping. The
  protocol can't enforce IRL physics; the Nostr identity layer is what gives
  victims a name to attach to a dispute.

There are no escrow funds to freeze, no reserve to seize, no honeypot that
makes the server a target worth attacking.

## Try it

- Live demo: <https://egavel.vercel.app> (listings, proxy bidding, wallet)
- Source: <https://github.com/sktr/eGavel> — MIT, TypeScript, Next.js + Hono,
  Node and Cloudflare Worker entrypoints sharing one codebase
- Design docs: `docs/how-it-works.md`, `docs/security.md`

The design is deliberately minimal: it needs only mints that support
NUT-07/08/10/11 — no custom server-side issuance, no federation, no
coordination beyond one auctioneer. It's the smallest thing that turns
NUT-11 P2PK into a marketplace-grade escrow protocol.