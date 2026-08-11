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

function makePublisher(): Publisher & { calls: unknown[]; pub: Publisher } {
  const calls: unknown[] = []
  const pub: Publisher = {
    publishSettlement(...args: unknown[]) {
      calls.push({ type: "settlement", args })
    },
    publishBid(...args: unknown[]) {
      calls.push({ type: "bid", args })
    },
  }
  return Object.assign(pub, { calls, pub })
}

describe("scheduler", () => {
  let db: Db

  beforeEach(() => {
    db = initDb()
  })

  function seedBid(auctionId: string, amount: number, receivedAt: number, id = `b${Math.random()}`) {
    db.saveBid({
      id,
      auction_id: auctionId,
      amount,
      bidder_npub: "npub-bidder",
      Y: `y-${id}`,
      received_at: receivedAt,
      status: "verified",
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
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    expect(db.getAuction("g1")!.state).toBe("ACTIVE")
  })

  it("settles after end_time + grace with the highest bid", async () => {
    const auction = makeAuction({ id: "g2", end_time: Date.now() - 40_000 })
    db.saveAuction(auction)
    seedBid("g2", 500, Date.now() - 400_000) // E - 6min: outside anti-sniping window
    seedBid("g2", 200, Date.now() - 500_000)
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    const settled = db.getAuction("g2")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe("npub-bidder")
    expect(settled.winning_amount).toBe(500)
  })

  it("does not extend for a bid inside the grace window (E, E+30s]", async () => {
    const endTime = Date.now() - 10_000 // past E, within grace
    const auction = makeAuction({ id: "g3", end_time: endTime })
    db.saveAuction(auction)
    seedBid("g3", 300, endTime + 10_000) // arrived in grace
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    expect(db.getAuction("g3")!.state).toBe("ACTIVE") // not yet settled (still within grace), and not extended
  })

  it("extends when a bid arrived within the last 5 minutes before E", async () => {
    const endTime = Date.now() + 60_000
    const auction = makeAuction({ id: "g4", end_time: endTime })
    db.saveAuction(auction)
    seedBid("g4", 300, endTime - 60_000) // 1 min before E, within the window
    const scheduler = createScheduler(db, makePublisher())
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
    seedBid("g5", 500, Date.now() - 400_000)
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    const settled = db.getAuction("g5")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBeNull()
    expect(settled.winning_amount).toBe(0)
  })

  it("publishes settlement with result tags", async () => {
    const auction = makeAuction({ id: "g6", end_time: Date.now() - 40_000, reserve_price: 1000 })
    db.saveAuction(auction)
    seedBid("g6", 500, Date.now() - 400_000)
    const { pub, calls } = makePublisher()
    const scheduler = createScheduler(db, pub)
    await scheduler.tick()
    const call = calls.find((c: any) => c.type === "settlement") as any
    expect(call).toBeTruthy()
    expect(call.args[5]).toBe("reserve_not_met")
  })

  it("settles a winning bid above reserve as sold", async () => {
    const auction = makeAuction({ id: "g7", end_time: Date.now() - 40_000, reserve_price: 1000 })
    db.saveAuction(auction)
    seedBid("g7", 1500, Date.now() - 400_000)
    const { pub, calls } = makePublisher()
    const scheduler = createScheduler(db, pub)
    await scheduler.tick()
    const call = calls.find((c: any) => c.type === "settlement") as any
    expect(call.args[5]).toBe("sold")
  })
})
