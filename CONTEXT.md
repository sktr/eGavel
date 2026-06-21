# Cashu Auction — Domain Glossary

A non-custodial auction platform built on Cashu e-cash.

## Language

**Lot**:
An individual item put up for auction.
_Avoid_: Item, listing, product

**English Auction**:
An ascending auction where the highest bidder within the time limit wins.
_Avoid_: — (there is no Japanese equivalent in this codebase)

**Auction**:
A time-limited event that auctions a single Lot. Has a start time and an end time.
_Avoid_: Event, session

**Seller**:
The person listing a Lot.
_Avoid_: Owner, creator

**Bidder**:
The person bidding on an Auction.
_Avoid_: Buyer, participant

**Bid**:
A commitment to pay up to a certain amount, backed by a P2PK Cashu proof bundle.
_Avoid_: Offer

**Max Bid (max_amount)**:
The ceiling a bidder commits to. Equal to the total value of the locked proofs. Never exposed by the API (see Max secrecy).
_Avoid_: Bid amount (in the first-price sense)

**Standing Price (current_amount)**:
The price the auction currently stands at, computed by the engine from all bidders' maxes: `min(highest max, 2nd-highest max + min increment)`, or the start price with a single bidder. This is what the winner pays.
_Avoid_: Current bid amount (the entered max)

**Min Bid Increment**:
The per-amount-band step the engine adds to the second-highest max when computing the standing price (Yahoo-style table, `lib/min-increment.ts`).
_Avoid_: —

**P2PK Proof**:
A Cashu token locked via NUT-11 P2PK to a public key, with locktime and refund conditions.
_Avoid_: Token, UTXO

**2-of-3 Lock**:
The P2PK lock of a bid proof: `data` (seller) and `pubkeys` (server, bidder), `n_sigs = 2`. No single party can spend the funds; two of the three keys are required.
_Avoid_: Multisig, escrow

**Bid Verification**:
The process by which the server validates a bidder's proofs (amount, lock structure, NUT-06/NUT-07). Only verified bids count toward the auction.
_Avoid_: KYC, confirmation

**Outbid / Instant Refund**:
A bid is outbid when a higher max arrives. The losing bid is immediately refundable via bidder + server co-signature (no locktime wait).
_Avoid_: —

**Settlement**:
The process by which the server determines the winner at the standing price after the end time and marks the auction SETTLED.
_Avoid_: Payment, finalization (Payment is only relevant at claim)

**Anti-sniping**:
A bid in the last 5 minutes before the end time extends the auction by 5 minutes.
_Avoid_: Overtime

**Grace Window**:
Bids are still accepted for 30 seconds after the end time E (E+30s). Bids inside the grace window do not trigger an extension.
_Avoid_: Overtime

**Reserve Price**:
The minimum price required for a sale. If the standing price is below it, there is no winner (`reserve_not_met`).
_Avoid_: Minimum bid

**Buy Now**:
A fixed price. When a max reaches it, the auction settles immediately at `buy_now_price` and that bidder wins.
_Avoid_: Instant purchase

**Claim**:
The seller collects the winner's proofs. Requires seller + server co-signature (2-of-3). The server splits the proofs into `[seller net, operator fee, winner change]`.
_Avoid_: Receive, payment

**Change**:
The excess of the winner's locked max over the standing price, returned to the winner as a 1-of-1 P2PK output during the claim swap. Collected via `GET /api/auctions/:id/change`.
_Avoid_: Refund (refund is for outbid bids)

**Co-sign**:
The server's Schnorr signature over a proof secret, required for claim/refund unlocks.
_Avoid_: Approval, authentication

**Recovery Phrase**:
The 12-word BIP-39 mnemonic that derives the account key. The account is the key; the phrase is the backup and the cross-device restore mechanism.
_Avoid_: Password

**Legacy Listing**:
An old-format auction without a `mint_url`. Cannot accept bids.
_Avoid_: Old auction
