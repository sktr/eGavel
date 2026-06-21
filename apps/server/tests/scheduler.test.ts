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
    end_time: Date.now() + 300_000,
    seller_pubkey: "abc",
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    ...overrides,
  }
}

function makePublisher(): Publisher & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    publishSettlement(auctionId, sellerPubkey, winnerNpub, amount, bidsChecked) {
      calls.push({ type: "settlement", auctionId, sellerPubkey, winnerNpub, amount, bidsChecked })
    },
    publishBid(auctionId, sellerPubkey, bidderNpub, amount, Y, receivedAt) {
      calls.push({ type: "bid", auctionId, sellerPubkey, bidderNpub, amount, Y, receivedAt })
    },
  }
}

describe("scheduler", () => {
  let db: Db

  beforeEach(() => {
    db = initDb()
  })

  it("settles with correct winner", () => {
    const publisher = makePublisher()
    const scheduler = createScheduler(db, publisher)

    const auction = makeAuction({ id: "a1", end_time: Date.now() - 1000 })
    db.saveAuction(auction)
    db.saveBid({
      id: "b1",
      auction_id: "a1",
      amount: 500,
      bidder_npub: "npub-winner",
      Y: "y1",
      received_at: 1,
      status: "verified",
    })
    db.saveBid({
      id: "b2",
      auction_id: "a1",
      amount: 200,
      bidder_npub: "npub-loser",
      Y: "y2",
      received_at: 2,
      status: "verified",
    })

    scheduler.tick()

    const settled = db.getAuction("a1")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe("npub-winner")
    expect(settled.winning_amount).toBe(500)

    expect(publisher.calls).toHaveLength(1)
    expect(publisher.calls[0]).toMatchObject({
      type: "settlement",
      winnerNpub: "npub-winner",
      amount: 500,
    })
  })

  it("resolves highest bid with earliest time", () => {
    const publisher = makePublisher()
    const scheduler = createScheduler(db, publisher)

    const auction = makeAuction({ id: "a2", end_time: Date.now() - 1000 })
    db.saveAuction(auction)
    db.saveBid({
      id: "b3",
      auction_id: "a2",
      amount: 500,
      bidder_npub: "npub-early",
      Y: "y3",
      received_at: 1,
      status: "verified",
    })
    db.saveBid({
      id: "b4",
      auction_id: "a2",
      amount: 500,
      bidder_npub: "npub-late",
      Y: "y4",
      received_at: 5,
      status: "verified",
    })

    scheduler.tick()

    const settled = db.getAuction("a2")!
    expect(settled.winner_npub).toBe("npub-early")
    expect(settled.winning_amount).toBe(500)
  })

  it("produces null winner when no bids", () => {
    const publisher = makePublisher()
    const scheduler = createScheduler(db, publisher)

    const auction = makeAuction({ id: "a3", end_time: Date.now() - 1000 })
    db.saveAuction(auction)

    scheduler.tick()

    const settled = db.getAuction("a3")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBeNull()
    expect(settled.winning_amount).toBe(0)

    expect(publisher.calls).toHaveLength(1)
    expect(publisher.calls[0]).toMatchObject({
      type: "settlement",
      winnerNpub: null,
      amount: 0,
    })
  })

  it("produces null winner when highest bid below start_price", () => {
    const publisher = makePublisher()
    const scheduler = createScheduler(db, publisher)

    const auction = makeAuction({
      id: "a4",
      end_time: Date.now() - 1000,
      start_price: 500,
    })
    db.saveAuction(auction)
    db.saveBid({
      id: "b5",
      auction_id: "a4",
      amount: 200,
      bidder_npub: "npub-lowball",
      Y: "y5",
      received_at: 1,
      status: "verified",
    })

    scheduler.tick()

    const settled = db.getAuction("a4")!
    expect(settled.winner_npub).toBeNull()
    expect(settled.winning_amount).toBe(0)
  })

  it("extends auction when bid arrives within 5 min of end", () => {
    const publisher = makePublisher()
    const scheduler = createScheduler(db, publisher)

    const fiveMinAgo = Date.now() - 5 * 60_000
    const auction = makeAuction({
      id: "a5",
      end_time: fiveMinAgo,
    })
    db.saveAuction(auction)
    // bid arrived 1 min before end (within 5 min window)
    db.saveBid({
      id: "b6",
      auction_id: "a5",
      amount: 300,
      bidder_npub: "npub-sniper",
      Y: "y6",
      received_at: fiveMinAgo - 60_000,
      status: "verified",
    })

    scheduler.tick()

    const extended = db.getAuction("a5")!
    expect(extended.state).toBe("EXTENDED")
    expect(extended.last_extended_at).not.toBeNull()
  })

  it("settles auction with no recent bids at end time", () => {
    const publisher = makePublisher()
    const scheduler = createScheduler(db, publisher)

    const sixMinAgo = Date.now() - 6 * 60_000
    const auction = makeAuction({
      id: "a6",
      end_time: sixMinAgo,
    })
    db.saveAuction(auction)
    // bid arrived 10 min before end (outside 5 min window)
    db.saveBid({
      id: "b7",
      auction_id: "a6",
      amount: 300,
      bidder_npub: "npub-early",
      Y: "y7",
      received_at: sixMinAgo - 10 * 60_000,
      status: "verified",
    })

    scheduler.tick()

    const settled = db.getAuction("a6")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe("npub-early")
  })

  it("is idempotent on already settled auction", () => {
    const publisher = makePublisher()
    const scheduler = createScheduler(db, publisher)

    const auction = makeAuction({
      id: "a7",
      state: "SETTLED",
      end_time: Date.now() - 1000,
      winner_npub: "npub-winner",
      winning_amount: 500,
    })
    db.saveAuction(auction)

    scheduler.tick()

    const settled = db.getAuction("a7")!
    expect(settled.winner_npub).toBe("npub-winner")
    expect(settled.winning_amount).toBe(500)
    expect(settled.state).toBe("SETTLED")
    expect(publisher.calls).toHaveLength(0)
  })
})
