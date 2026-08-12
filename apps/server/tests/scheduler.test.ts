import { describe, it, expect, beforeEach } from "vite-plus/test"
import type { Auction } from "@cashu-auction/shared"
import { initDb, type Db } from "../src/db/index.js"
import { createScheduler } from "../src/scheduler/index.js"
import type { Publisher } from "../src/nostr/publisher.js"

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "test-1",
    item: "test item",
    description: "desc",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 300_000,
    seller_pubkey: "abc",
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  }
}

describe("scheduler", () => {
  let db: Db

  beforeEach(() => {
    db = initDb()
  })

  function seedBid(
    auctionId: string,
    maxAmount: number,
    currentAmount: number,
    receivedAt: number,
    id = `b${Math.random()}`,
    bidder = "npub-bidder",
    status: "verified" | "outbid" = "verified",
  ) {
    db.saveBid({
      id,
      auction_id: auctionId,
      max_amount: maxAmount,
      current_amount: currentAmount,
      bidder_npub: bidder,
      Y: `y-${id}`,
      received_at: receivedAt,
      status,
      proof_data: null,
    })
  }

  // NOTE: `tick()` is now async (it awaits `withAuctionLock`) — always await it.
  // Anti-sniping window is [E - 5min, E]: bids seeded at `end_time - 6min` (i.e.
  // `Date.now() - 400_000` when `end_time = Date.now() - 40_000`) stay OUTSIDE the
  // window so the auction settles instead of extending.

  it("does not settle before end_time + grace", async () => {
    const auction = makeAuction({ id: "g1", end_time: Date.now() + 10_000 })
    db.saveAuction(auction)
    const scheduler = createScheduler(db)
    await scheduler.tick()
    expect(db.getAuction("g1")!.state).toBe("ACTIVE")
  })

  it("settles after end_time + grace with the standing price", async () => {
    const auction = makeAuction({ id: "g2", end_time: Date.now() - 40_000 })
    db.saveAuction(auction)
    // Leader: max 500, standing at 310 (pushed by the 300-max bidder).
    seedBid("g2", 500, 310, Date.now() - 400_000, "b1", "npub-bidder") // E - 6min: outside anti-sniping window
    seedBid("g2", 300, 300, Date.now() - 500_000, "b2", "npub-underbidder", "outbid")
    const scheduler = createScheduler(db)
    await scheduler.tick()
    const settled = db.getAuction("g2")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe("npub-bidder")
    expect(settled.winning_amount).toBe(310) // current_amount, not the max
  })

  it("does not extend for a bid inside the grace window (E, E+30s]", async () => {
    const endTime = Date.now() - 10_000 // past E, within grace
    const auction = makeAuction({ id: "g3", end_time: endTime })
    db.saveAuction(auction)
    seedBid("g3", 300, 300, endTime + 10_000) // arrived in grace
    const scheduler = createScheduler(db)
    await scheduler.tick()
    expect(db.getAuction("g3")!.state).toBe("ACTIVE") // not yet settled (still within grace), and not extended
  })

  it("extends when a bid arrived within the last 5 minutes before E", async () => {
    const endTime = Date.now() + 60_000
    const auction = makeAuction({ id: "g4", end_time: endTime })
    db.saveAuction(auction)
    seedBid("g4", 300, 300, endTime - 60_000) // 1 min before E, within the window
    const scheduler = createScheduler(db)
    await scheduler.tick()
    const auction2 = db.getAuction("g4")!
    expect(auction2.state).toBe("EXTENDED")
    expect(auction2.end_time).toBe(endTime + 5 * 60_000)
  })

  it("does not settle a reserve not met", async () => {
    const auction = makeAuction({
      id: "g5",
      end_time: Date.now() - 40_000,
      reserve_price: 1000,
    })
    db.saveAuction(auction)
    seedBid("g5", 500, 500, Date.now() - 400_000)
    const scheduler = createScheduler(db)
    await scheduler.tick()
    const settled = db.getAuction("g5")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBeNull()
    expect(settled.winning_amount).toBe(0)
  })

  it("publishes settlement with result tags", async () => {
    const auction = makeAuction({ id: "g6", end_time: Date.now() - 40_000, reserve_price: 1000 })
    db.saveAuction(auction)
    seedBid("g6", 500, 500, Date.now() - 400_000)
    const scheduler = createScheduler(db)
    await scheduler.tick()
  })

  it("settles a winning bid above reserve as sold", async () => {
    const auction = makeAuction({ id: "g7", end_time: Date.now() - 40_000, reserve_price: 1000 })
    db.saveAuction(auction)
    seedBid("g7", 1500, 1500, Date.now() - 400_000)
    const scheduler = createScheduler(db)
    await scheduler.tick()
  })

  it("settles a bidless auction past E+grace as no_bids", async () => {
    const auction = makeAuction({ id: "g8", end_time: Date.now() - 40_000 })
    db.saveAuction(auction)
    const scheduler = createScheduler(db)
    await scheduler.tick()
    const settled = db.getAuction("g8")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBeNull()
  })
})
