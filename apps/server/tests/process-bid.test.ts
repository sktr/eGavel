import { describe, it, expect, beforeEach } from "vite-plus/test"
import { initDb, type Db } from "../src/db/index.js"
import { processBid } from "../src/process-bid.js"
import type { Publisher } from "../src/nostr/publisher.js"
import type { Auction } from "@cashu-auction/shared"

const SELLER = "02deadbeef"
const SERVER = "04server"
const BIDDER = "03cafebabe"

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "a1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: SELLER,
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  }
}

function p2pk(data: string, locktime: number, refund: string, nonce: string): string {
  return JSON.stringify([
    "P2PK",
    {
      nonce,
      data,
      tags: [
        ["pubkeys", SERVER],
        ["n_sigs", "2"],
        ["locktime", String(locktime)],
        ["refund", refund],
      ],
    },
  ])
}

function payload(auction: Auction, amount: number, nonce: string) {
  const locktime = Math.ceil((auction.end_time + 24 * 3600_000) / 1000) + 100
  return {
    proof: {
      id: "keyset1",
      amount,
      secret: p2pk(SELLER, locktime, BIDDER, nonce),
      C: "c",
    },
    mint_url: "test://local",
    auction_id: auction.id,
    amount,
    bidder_pubkey: BIDDER,
  }
}

function makePublisher() {
  const calls: unknown[] = []
  const pub: Publisher = {
    publishBid(...args) {
      calls.push({ type: "bid", args })
    },
    publishSettlement(...args) {
      calls.push({ type: "settlement", args })
    },
  }
  return { pub, calls }
}

describe("processBid", () => {
  let db: Db
  beforeEach(() => {
    db = initDb()
    process.env.ALLOW_TEST_BIDS = "1"
  })

  it("rejects a bid for an unknown auction", async () => {
    const { pub } = makePublisher()
    const auction = makeAuction()
    const result = await processBid(payload(auction, 200, "n1"), db, pub, SERVER)
    expect(result).toEqual({ ok: false, error: "auction not found" })
  })

  it("records a verified bid and publishes kind:39001", async () => {
    const { pub, calls } = makePublisher()
    const auction = makeAuction()
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 200, "n1"), db, pub, SERVER)
    expect(result.ok).toBe(true)
    const bids = db.getVerifiedBids("a1")
    expect(bids).toHaveLength(1)
    expect(bids[0]!.amount).toBe(200)
    expect(calls.some((c: any) => c.type === "bid")).toBe(true)
  })

  it("marks the previous bid of the same bidder as replaced", async () => {
    const { pub } = makePublisher()
    const auction = makeAuction()
    db.saveAuction(auction)
    await processBid(payload(auction, 200, "n1"), db, pub, SERVER)
    await processBid(payload(auction, 300, "n2"), db, pub, SERVER)
    const bids = db.getVerifiedBids("a1")
    expect(bids).toHaveLength(1)
    expect(bids[0]!.amount).toBe(300)
  })

  it("immediately settles when amount >= buy_now_price", async () => {
    const { pub, calls } = makePublisher()
    const auction = makeAuction({ buy_now_price: 1000 })
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 1000, "n3"), db, pub, SERVER)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.buyNow).toBe(true)
    const settled = db.getAuction("a1")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe(BIDDER)
    expect(settled.winning_amount).toBe(1000)
    expect(calls.some((c: any) => c.type === "settlement")).toBe(true)
  })

  it("does not settle early for a normal high bid below buy_now_price", async () => {
    const { pub } = makePublisher()
    const auction = makeAuction({ buy_now_price: 1000 })
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 500, "n4"), db, pub, SERVER)
    expect(result.ok).toBe(true)
    expect(db.getAuction("a1")!.state).toBe("ACTIVE")
  })

  afterAll(() => {
    delete process.env.ALLOW_TEST_BIDS
  })
})
