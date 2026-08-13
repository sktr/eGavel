import type { Auction } from "@cashu-auction/shared"
import type { Db } from "../db/index.js"

/**
 * Event-driven settlement (lazy settle) + anti-sniping timing constants.
 *
 * There is no background scheduler: an auction is settled when it is READ and
 * found to be past `end_time + GRACE_MS`. The transition is atomic
 * (`settleAuction`), so concurrent reads settle exactly once.
 */

export const EXTEND_BY = 5 * 60_000
export const GRACE_MS = 30_000
export const ANTI_SNIPING_WINDOW = 5 * 60_000

/**
 * Settle `auction` if it is past E+grace. Returns the auction's current DB
 * state (reloaded after the atomic transition).
 */
export async function settleIfDue(db: Db, auction: Auction): Promise<Auction> {
  if (auction.state !== "ACTIVE" && auction.state !== "EXTENDED") return auction
  if (Date.now() < auction.end_time + GRACE_MS) return auction

  const bids = await db.getVerifiedBids(auction.id)
  const threshold = Math.max(auction.start_price, auction.reserve_price ?? auction.start_price)

  let winner: string | null = null
  let amount = 0
  if (bids.length > 0 && bids[0]!.current_amount >= threshold) {
    winner = bids[0]!.bidder_npub
    amount = bids[0]!.current_amount
  }

  await db.settleAuction(auction.id, winner, amount)
  return (await db.getAuction(auction.id)) ?? auction
}
