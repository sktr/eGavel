export type AuctionState =
  | "PENDING"
  | "ACTIVE"
  | "EXTENDED"
  | "CLOSED"
  | "SETTLED"

/** Bid locktime margin: how long after auction end the seller has to claim
 * before the winner can recover their funds. 7 days to allow shipping prep. */
export const LOCKTIME_MS = 7 * 24 * 60 * 60 * 1000

export interface Auction {
  id: string
  item: string
  description: string
  start_price: number
  reserve_price: number | null
  buy_now_price: number | null
  end_time: number
  seller_pubkey: string
  state: AuctionState
  start_time: number
  last_extended_at: number | null
  winner_npub: string | null
  winning_amount: number | null
  mint_url: string
  category?: string
  condition?: string
  shipping?: string
  /** Legacy single image (data URL or remote URL). Kept for backward compatibility. */
  image?: string
  /** All listing images as data URLs (max 4). */
  images?: string[]
  /**
   * Standing price in sats (second-price). Computed by the engine from all
   * verified bids' max_amounts; present on API responses, absent when the
   * auction has no verified bids (clients fall back to start_price).
   */
  current_amount?: number
  /** True once the seller has claimed the winning bid (claim idempotency). */
  claimed?: boolean
}

export interface Bid {
  id: string
  auction_id: string
  /** Max bid (proxy bidding). Equals the total value of the locked proofs. */
  max_amount: number
  /** Standing price. Computed by the engine from all bidders' max_amounts. */
  current_amount: number
  bidder_npub: string
  Y: string
  received_at: number
  status: "pending" | "verified" | "outbid" | "refunded"
  proof_data: string | null  // JSON: { keyset_id, C, secret, mint_url }
}

/**
 * Public shape of a bid. max_amount, Y and proof_data stay server-side; only
 * current_amount (the standing price) is exposed (second-price incentive protection).
 */
export type PublicBid = Omit<Bid, "max_amount" | "Y" | "proof_data">

export interface Settlement {
  auction_id: string
  winner_npub: string | null
  winning_amount: number
  bids_checked: number
  settled_at: number
}
