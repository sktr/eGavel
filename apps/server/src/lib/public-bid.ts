import type { Bid, PublicBid } from "@cashu-auction/shared"

/**
 * Converts a bid into its public API shape. max_amount, Y and proof_data
 * stay server-side; only current_amount (the standing price) is exposed.
 * Leaking the leader's max would let others snipe with max+1 bids.
 */
export function toPublicBid(bid: Bid): PublicBid {
  const { max_amount, Y, proof_data, ...pub } = bid
  void max_amount
  void Y
  void proof_data
  return pub
}
