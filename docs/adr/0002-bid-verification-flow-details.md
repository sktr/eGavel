# Bid verification flow details (kind schema, outbid self-rebids, thresholds)

Implementation details that flesh out the server-mediated scheme decided in ADR-0001.

Status: accepted

## Decision

### Kind schema

kind:39001 (Bid) is published by the operator server, with this unified structure:

```json
{
  "kind": 39001,
  "pubkey": "<server_pubkey>",
  "tags": [
    ["a", "39000:<seller_pubkey>:<auction_id>"],
    ["p", "<bidder_npub>"],
    ["Y", "<hash_to_curve_value>"]
  ],
  "content": "{\"amount\":<sat>,\"received_at\":<unix_ts>}"
}
```

kind:39003 (Settlement) is published by the operator server:

```json
{
  "kind": 39003,
  "pubkey": "<server_pubkey>",
  "tags": [
    ["a", "39000:<seller_pubkey>:<auction_id>"],
    ["p", "<winner_npub>"],
    ["winner_amount", "<winning_sat>"]
  ],
  "content": "{\"bids_checked\":<int>,\"settled_at\":<unix_ts>}"
}
```

### Outbid self-rebids

Early release of the old P2PK Proof is **standard behavior**, executed via the operator server's co-signature. It is not an optional feature.

### Bids below the start price

Rejected during verification by the operator server; no kind:39001 is published.

### Locktime margin

A Proof's locktime is `auction_end + 24h`.

### End-time determination

The operator server uses the received time (`received_at`). Nostr's `created_at` is kept as a reference but never used for end-time determination. To account for relay latency, arrivals up to `end_time + 30s` are treated as valid bids.

### DM encryption

Proofs sent from the bidder to the operator server use NIP-17 (Gift Wrap). Token transfers from the winner to the seller also use NIP-17.

### Settlement flow

The winner sends the P2PK token to the seller via a NIP-17 DM at their own timing. No automatic transfer.

Reasons:
- Minimizes the time the server holds Proof information (only during verification; not retained)
- The risk of a winner not paying is limited to the seller's opportunity loss; it causes no third-party loss of funds
- Winner protection is solved separately by the HTLC introduction in Phase 2
