import type { Auction } from "@cashu-auction/shared"
import type { Db } from "../db/index.js"
import { withAuctionLock } from "../lib/auction-lock.js"

const POLL_INTERVAL = 60_000
const EXTEND_BY = 5 * 60_000
const GRACE_MS = 30_000
const ANTI_SNIPING_WINDOW = 5 * 60_000

export function createScheduler(db: Db) {
  let timer: ReturnType<typeof setInterval> | null = null

  async function tick() {
    const now = Date.now()

    const needingCheck = await db.getActiveAuctions()

    for (const auction of needingCheck) {
      await withAuctionLock(auction.id, async () => {
        const current = await db.getAuction(auction.id)
        if (!current) return
        if (current.state !== "ACTIVE" && current.state !== "EXTENDED") return

        const bids = await db.getVerifiedBids(current.id)
        const e = current.end_time

        // Only consider bids that arrived before E for extension (spec §5.2)
        const hasSnipingBid = bids.some(
          (b) => b.received_at <= e && b.received_at > e - ANTI_SNIPING_WINDOW,
        )

        if (hasSnipingBid) {
          // Anti-sniping: extend by a full 5 minutes from the original end (spec §5.1)
          current.state = "EXTENDED"
          current.end_time = e + EXTEND_BY
          current.last_extended_at = now
          await db.saveAuction(current)
          return
        }

        if (now < e + GRACE_MS) {
          // still inside grace with no sniping bid: wait
          return
        }

        await settle(current, bids, db)
      })
    }
  }

  async function settle(auction: Auction, bids: Awaited<ReturnType<Db["getVerifiedBids"]>>, db: Db) {
    const bidsChecked = bids.length

    const threshold = Math.max(
      auction.start_price,
      auction.reserve_price ?? auction.start_price,
    )

    if (bidsChecked === 0 || bids[0]!.current_amount < threshold) {
      auction.winner_npub = null
      auction.winning_amount = 0
    } else {
      const winner = bids[0]!
      auction.winner_npub = winner.bidder_npub
      auction.winning_amount = winner.current_amount
    }

    auction.state = "SETTLED"
    await db.saveAuction(auction)
  }

  return {
    start() {
      timer = setInterval(() => {
        tick().catch((err) => console.error("scheduler tick failed", err))
      }, POLL_INTERVAL)
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
