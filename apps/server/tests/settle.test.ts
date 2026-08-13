import { describe, it, expect, beforeEach } from "vite-plus/test"
import { initDb, type Db } from "../src/db/index.js"
import { settleIfDue } from "../src/lib/settle.js"
import type { Auction, Bid } from "@egavel/shared"

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "a1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  }
}

function seedBid(db: Db, auctionId: string, max: number, current: number, receivedAt: number, bidder = "03cafebabe") {
  const b: Bid = {
    id: `b-${max}-${receivedAt}`,
    auction_id: auctionId,
    max_amount: max,
    current_amount: current,
    bidder_npub: bidder,
    Y: `Y-${max}-${receivedAt}`,
    received_at: receivedAt,
    status: "verified",
    proof_data: null,
  }
  return db.saveBid(b)
}

describe("settleIfDue (lazy settle)", () => {
  let db: Db
  beforeEach(() => {
    db = initDb()
  })

  it("settles an auction past E+grace, picking the highest standing price", async () => {
    const auction = makeAuction({ end_time: Date.now() - 60_000 }) // E + 60s > grace
    db.saveAuction(auction)
    await seedBid(db, "a1", 500, 210, Date.now() - 400_000) // current_amount = standing price
    await seedBid(db, "a1", 300, 300, Date.now() - 500_000, "04other")

    const settled = await settleIfDue(db, auction)
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe("03cafebabe")
    expect(settled.winning_amount).toBe(210)
  })

  it("does not settle before E+grace", async () => {
    const auction = makeAuction({ end_time: Date.now() + 10_000 })
    db.saveAuction(auction)
    await seedBid(db, "a1", 500, 210, Date.now() - 400_000)

    const after = await settleIfDue(db, auction)
    expect(after.state).toBe("ACTIVE")
  })

  it("leaves the winner null when the reserve is not met", async () => {
    const auction = makeAuction({ end_time: Date.now() - 60_000, reserve_price: 1000 })
    db.saveAuction(auction)
    await seedBid(db, "a1", 500, 500, Date.now() - 400_000) // 500 < reserve 1000

    const settled = await settleIfDue(db, auction)
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBeNull()
    expect(settled.winning_amount).toBe(0)
  })

  it("leaves the winner null when there are no bids", async () => {
    const auction = makeAuction({ end_time: Date.now() - 60_000 })
    db.saveAuction(auction)

    const settled = await settleIfDue(db, auction)
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBeNull()
    expect(settled.winning_amount).toBe(0)
  })

  it("is idempotent — a second call leaves the settled state unchanged", async () => {
    const auction = makeAuction({ end_time: Date.now() - 60_000 })
    db.saveAuction(auction)
    await seedBid(db, "a1", 500, 210, Date.now() - 400_000)

    const first = await settleIfDue(db, auction)
    const second = await settleIfDue(db, first)
    expect(second.state).toBe("SETTLED")
    expect(second.winner_npub).toBe(first.winner_npub)
    expect(second.winning_amount).toBe(first.winning_amount)
  })
})
