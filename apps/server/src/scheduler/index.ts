import type { Auction } from "@cashu-auction/shared"
import type { Db } from "../db/index.js"
import type { Publisher } from "../nostr/publisher.js"
import { createPublisher } from "../nostr/publisher.js"

const POLL_INTERVAL = 60_000
const EXTEND_BY = 5 * 60_000

export function createScheduler(
  db: Db,
  publisher?: Publisher,
) {
  let timer: ReturnType<typeof setInterval> | null = null
  const pub = publisher ?? createPublisher()

  function tick() {
    const now = Date.now()

    const needingCheck = db.getActiveAuctions()

    for (const auction of needingCheck) {
      // Only process auctions past their end_time
      if (now < auction.end_time) continue

      const bids = db.getVerifiedBids(auction.id)
      const hasRecentBid = bids.some(
        (b) => b.received_at > auction.end_time - EXTEND_BY,
      )

      if (hasRecentBid) {
        auction.state = "EXTENDED"
        auction.end_time = now + EXTEND_BY
        auction.last_extended_at = now
      } else {
        settle(auction)
      }

      db.saveAuction(auction)
    }
  }

  function settle(auction: Auction) {
    const bids = db.getVerifiedBids(auction.id)
    const bidsChecked = bids.length

    if (bidsChecked === 0 || bids[0]!.amount < auction.start_price) {
      pub.publishSettlement(
        auction.id,
        auction.seller_pubkey,
        null,
        0,
        bidsChecked,
      )
      auction.winner_npub = null
      auction.winning_amount = 0
    } else {
      const winner = bids[0]!
      pub.publishSettlement(
        auction.id,
        auction.seller_pubkey,
        winner.bidder_npub,
        winner.amount,
        bidsChecked,
      )
      auction.winner_npub = winner.bidder_npub
      auction.winning_amount = winner.amount
    }

    auction.state = "SETTLED"
  }

  return {
    start() {
      timer = setInterval(tick, POLL_INTERVAL)
      console.log("scheduler started (interval: 60s)")
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      console.log("scheduler stopped")
    },
    tick,
  }
}
