# Adopt server-mediated bid verification (Type B)

NUT-07 only confirms whether a Y is unspent — it cannot verify the amount, so a scheme is needed to make bid amounts trustworthy. Publishing the full Proof lets third parties steal the token; to stay non-custodial, the minimal trade-off is having the operator server temporarily receive the Proof, verify it, and discard it.

Status: accepted

## Decision

The operator server receives the bidder's Proof via NIP-17 DM and, after verifying the following, publishes it as a verified bid (kind:39001):

1. The Proof balance (amount) matches the bid amount
2. The P2PK `data` is locked to `seller_pubkey`
3. The locktime is at or after `auction_end_time`
4. The refund condition includes `bidder_pubkey`
5. NUT-07 confirms Y is unspent
6. For an outbid self-rebid, the previous Proof is released via co-signature

The operator server does not retain the Proof after verification.

## Alternatives considered

- **A: Publish the full Proof (include it in kind:39001)** — third parties learn secret/C and can steal the token. Completely forfeits non-custodiality.
- **C: Escrow (hold the tokens on the operator server)** — breaks non-custodiality; the operator gains control over tokens.
- **D: No amount verification (deter fake bids with social/economic penalties)** — not a realistic deterrent; 1 sat can lie about a 1,000,000 sat bid.

## Result

- The operator server does not hold tokens, preserving non-custodiality
- Using NIP-17 to send Proofs reduces eavesdropping risk
- The operator server can refuse verification (reduced censorship resistance), but anyone can audit the operator's behavior

## Future extensibility

Current NUT standards offer no way to verify the amount without disclosing Proof information (secret/C). The following approaches would allow amount verification without the server seeing the Proof:

- **NUT extension: mint-signed amount proof** — an endpoint where the mint signs "the balance of this Y is X". If standardized as a NUT, the server could verify amounts without receiving the Proof itself.
- **ZKP (zero-knowledge proof)** — expressing the hash_to_curve circuit (including SHA-256) with zk-STARKs to prove the amount without disclosing the secret. StarkWare has funded Cashu × STARK research, but no production implementation exists. Theoretically possible, but proof-generation cost (seconds to minutes on a device), proof size (tens to hundreds of KB), and the lack of standardization are open problems. Deferred until after this product ships; Phase 1 uses the current approach.
