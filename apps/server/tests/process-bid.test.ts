import { describe, it, expect, beforeEach, afterAll } from "vite-plus/test"
import { initDb, type Db } from "../src/db/index.js"
import { processBid } from "../src/process-bid.js"
import type { Auction } from "@cashu-auction/shared"

const SELLER = "02deadbeef"
const SERVER = "04server"
const BIDDER = "03cafebabe"
const BIDDER2 = "05otherbidder"

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
        ["pubkeys", SERVER, refund],
        ["n_sigs", "2"],
        ["locktime", String(locktime)],
        ["refund", refund],
      ],
    },
  ])
}

function payload(auction: Auction, max: number, nonce: string, bidder = BIDDER) {
  const locktime = Math.ceil((auction.end_time + 24 * 3600_000) / 1000) + 100
  return {
    proofs: [{
      id: "keyset1",
      amount: max,
      secret: p2pk(SELLER, locktime, bidder, nonce),
      C: "c",
    }],
    mint_url: "test://local",
    auction_id: auction.id,
    amount: max,
    bidder_pubkey: bidder,
  }
}

describe("processBid (proxy bidding)", () => {
  let db: Db
  beforeEach(() => {
    db = initDb()
    process.env.ALLOW_TEST_BIDS = "1"
  })
  afterAll(() => {
    delete process.env.ALLOW_TEST_BIDS
  })

  it("rejects a bid for an unknown auction", async () => {
    const auction = makeAuction()
    const result = await processBid(payload(auction, 200, "n1"), db, SERVER)
    expect(result).toEqual({ ok: false, error: "auction not found" })
  })

  it("first bid locks the full max but stands at the start price", async () => {
    const auction = makeAuction()
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 500, "n1"), db, SERVER)
    expect(result.ok).toBe(true)
    const verified = db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.max_amount).toBe(500) // locked proofs == max
    expect(verified[0]!.current_amount).toBe(100) // standing price == start
  })

  it("a higher max takes the lead at second-price + increment", async () => {
    const auction = makeAuction()
    db.saveAuction(auction)
    await processBid(payload(auction, 200, "n1"), db, SERVER) // A: max 200
    const result = await processBid(payload(auction, 300, "n2", BIDDER2), db, SERVER) // B: max 300
    expect(result.ok).toBe(true)

    const verified = db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.bidder_npub).toBe(BIDDER2)
    expect(verified[0]!.max_amount).toBe(300)
    expect(verified[0]!.current_amount).toBe(210) // 200 + inc(200)=10

    const old = db.getBidsByBidder(BIDDER)
    expect(old[0]!.status).toBe("outbid")
  })

  it("price rises under the standing leader when a lower max bids between", async () => {
    const auction = makeAuction()
    db.saveAuction(auction)
    await processBid(payload(auction, 500, "n1"), db, SERVER) // A: max 500 → stands 100
    await processBid(payload(auction, 300, "n2", BIDDER2), db, SERVER) // B: max 300 < 500

    const verified = db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.bidder_npub).toBe(BIDDER) // A still leads
    expect(verified[0]!.current_amount).toBe(310) // min(500, 300+10)
    const b = db.getBidsByBidder(BIDDER2)[0]!
    expect(b.status).toBe("outbid")
    // max secrecy: an outbid bid's current_amount is the price, not its max
    expect(b.current_amount).toBe(310)
    expect(b.current_amount).not.toBe(300)
  })

  it("rejects a max at or below the current standing price", async () => {
    const auction = makeAuction()
    db.saveAuction(auction)
    await processBid(payload(auction, 500, "n1"), db, SERVER) // price 100
    await processBid(payload(auction, 300, "n2", BIDDER2), db, SERVER) // price 310
    const result = await processBid(payload(auction, 300, "n3"), db, SERVER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("BELOW_HIGHEST_BID")
  })

  it("rejects reusing the same proofs on another auction (double-lock)", async () => {
    const auction1 = makeAuction({ id: "a1" })
    const auction2 = makeAuction({ id: "a2" })
    db.saveAuction(auction1)
    db.saveAuction(auction2)

    // Same locktime / same secret → same Y (= same proofs) used on two auctions
    const locktime = Math.ceil((auction1.end_time + 24 * 3600_000) / 1000) + 100
    const sameProofs = (auctionId: string, amount: number) => ({
      proofs: [{ id: "ks1", amount, secret: p2pk(SELLER, locktime, BIDDER, "n1"), C: "c" }],
      mint_url: "test://local",
      auction_id: auctionId,
      amount,
      bidder_pubkey: BIDDER,
    })

    const first = await processBid(sameProofs("a1", 300), db, SERVER)
    expect(first.ok).toBe(true)

    const second = await processBid(sameProofs("a2", 300), db, SERVER)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain("PROOF_ALREADY_LOCKED")
  })

  it("a re-bid by the same bidder supersedes their own old bid", async () => {
    const auction = makeAuction()
    db.saveAuction(auction)
    await processBid(payload(auction, 200, "n1"), db, SERVER)
    await processBid(payload(auction, 400, "n2"), db, SERVER)

    const verified = db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.max_amount).toBe(400)
    const all = db.getBidsByBidder(BIDDER)
    expect(all.map((b) => b.status).sort()).toEqual(["outbid", "verified"])
  })

  it("a lower re-bid by the leader does not move the price", async () => {
    const auction = makeAuction()
    db.saveAuction(auction)
    await processBid(payload(auction, 1000, "n1"), db, SERVER) // price 100
    await processBid(payload(auction, 600, "n2"), db, SERVER) // same bidder, lower max

    const verified = db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.max_amount).toBe(1000)
    expect(verified[0]!.current_amount).toBe(100) // unchanged
  })

  it("three bidders: price is driven by the top two maxes", async () => {
    const auction = makeAuction()
    db.saveAuction(auction)
    await processBid(payload(auction, 500, "n1", "05a"), db, SERVER)
    await processBid(payload(auction, 300, "n2", "05b"), db, SERVER) // price 310
    await processBid(payload(auction, 2000, "n3", "05c"), db, SERVER) // max 2000

    const verified = db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.bidder_npub).toBe("05c")
    expect(verified[0]!.current_amount).toBe(510) // min(2000, 500+10)
  })

  it("immediately settles at buy_now_price when a max reaches it", async () => {
    const auction = makeAuction({ buy_now_price: 1000 })
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 1500, "n3"), db, SERVER)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.buyNow).toBe(true)
    const settled = db.getAuction("a1")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe(BIDDER)
    expect(settled.winning_amount).toBe(1000) // pays buy-now, not the max
    const bid = db.getVerifiedBids("a1")[0]!
    expect(bid.current_amount).toBe(1000)
  })

  it("does not settle early for a normal high bid below buy_now_price", async () => {
    const auction = makeAuction({ buy_now_price: 1000 })
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 500, "n4"), db, SERVER)
    expect(result.ok).toBe(true)
    expect(db.getAuction("a1")!.state).toBe("ACTIVE")
  })
})
