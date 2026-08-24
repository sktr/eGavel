import type { Auction } from "@egavel/shared"
import type { Db } from "../db/index.js"
import { ESCROW_TIMEOUT_MS } from "./escrow.js"

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
 *
 * Also processes escrow timeouts: deletes the escrow row so proofs are
 * available for winner sweep via the refund path after locktime.
 */
export async function settleIfDue(
  db: Db,
  auction: Auction,
): Promise<Auction> {
  if (auction.state !== "ACTIVE" && auction.state !== "EXTENDED") {
    // Auction already settled — check for escrow timeout
    await processEscrowTimeout(db, auction)
    return auction
  }
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
  const settled = (await db.getAuction(auction.id)) ?? auction

  // After settling, check for escrow timeout
  await processEscrowTimeout(db, settled)

  return settled
}

/**
 * Process escrow timeout: observe only — never move funds, never delete rows.
 *
 * The escrow proofs are P2PK-locked {seller, winner, server} (n_sigs=2), and
 * the server holds just one key, so no server-side routine can spend them
 * (non-custodial). Timeout resolution is therefore party-triggered:
 *   shipped → seller calls POST /auctions/:id/release after the timeout
 *   !shipped → winner calls POST /auctions/:id/refund after the timeout
 * The row MUST stay until funds actually move: proofs_data is the only
 * persisted copy of the escrow secrets; deleting it early makes the proofs
 * permanently unspendable by anyone.
 */
async function processEscrowTimeout(
  db: Db,
  auction: Auction,
): Promise<void> {
  if (auction.state !== "SETTLED") return

  const escrow = await db.getEscrow(auction.id)
  if (!escrow) return
  if (Date.now() < escrow.created_at + ESCROW_TIMEOUT_MS) return

  console.log(
    `Escrow timeout for ${auction.id}: shipped=${escrow.shipped}. ` +
    `Awaiting ${escrow.shipped ? "seller release" : "winner refund"} (party-triggered).`
  )
}
