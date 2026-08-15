import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest"
import { initDb, type Db } from "../src/db/index.js"
import { processBid, processPendingBid } from "../src/process-bid.js"
import { createAuctionRoutes } from "../src/routes/auctions.js"
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "../src/lib/hex.js"
import { LOCKTIME_MS } from "@egavel/shared"
import type { Auction } from "@egavel/shared"

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
  const locktime = Math.ceil((auction.end_time + LOCKTIME_MS) / 1000) + 100
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

describe("processBid (proxy bidding)", async () => {
  let db: Db
  beforeEach(async () => {
    db = initDb()
    process.env.ALLOW_TEST_BIDS = "1"
  })
  afterAll(async () => {
    delete process.env.ALLOW_TEST_BIDS
  })

  it("rejects a bid for an unknown auction", async () => {
    const auction = makeAuction()
    const result = await processBid(payload(auction, 200, "n1"), db, SERVER)
    expect(result).toEqual({ ok: false, error: "auction not found" })
  })

  it("first bid locks the full max but stands at the start price", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    const result = await processBid(payload(auction, 500, "n1"), db, SERVER)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.current_amount).toBe(100) // standing price == start
    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.max_amount).toBe(500) // locked proofs == max
    expect(verified[0]!.current_amount).toBe(100) // standing price == start
  })

  it("a higher max takes the lead at second-price + increment", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    await processBid(payload(auction, 200, "n1"), db, SERVER) // A: max 200
    const result = await processBid(payload(auction, 300, "n2", BIDDER2), db, SERVER) // B: max 300
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.current_amount).toBe(210) // 200 + inc(200)=10

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.bidder_npub).toBe(BIDDER2)
    expect(verified[0]!.max_amount).toBe(300)
    expect(verified[0]!.current_amount).toBe(210) // 200 + inc(200)=10

    const old = await db.getBidsByBidder(BIDDER)
    expect(old[0]!.status).toBe("outbid")
  })

  it("price rises under the standing leader when a lower max bids between", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    await processBid(payload(auction, 500, "n1"), db, SERVER) // A: max 500 → stands 100
    await processBid(payload(auction, 300, "n2", BIDDER2), db, SERVER) // B: max 300 < 500

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.bidder_npub).toBe(BIDDER) // A still leads
    expect(verified[0]!.current_amount).toBe(310) // min(500, 300+10)
    const b = (await db.getBidsByBidder(BIDDER2))[0]!
    expect(b.status).toBe("outbid")
    // max secrecy: an outbid bid's current_amount is the price, not its max
    expect(b.current_amount).toBe(310)
    expect(b.current_amount).not.toBe(300)
  })

  it("rejects a max at or below the current standing price", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    await processBid(payload(auction, 500, "n1"), db, SERVER) // price 100
    await processBid(payload(auction, 300, "n2", BIDDER2), db, SERVER) // price 310
    const result = await processBid(payload(auction, 300, "n3"), db, SERVER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("BELOW_HIGHEST_BID")
  })

  it("rejects reusing the same proofs on another auction (double-lock)", async () => {
    const auction1 = makeAuction({ id: "a1" })
    const auction2 = makeAuction({ id: "a2" })
    await db.saveAuction(auction1)
    await db.saveAuction(auction2)

    // Same locktime / same secret → same Y (= same proofs) used on two auctions
    const locktime = Math.ceil((auction1.end_time + LOCKTIME_MS) / 1000) + 100
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
    await db.saveAuction(auction)
    await processBid(payload(auction, 200, "n1"), db, SERVER)
    await processBid(payload(auction, 400, "n2"), db, SERVER)

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.max_amount).toBe(400)
    const all = await db.getBidsByBidder(BIDDER)
    expect(all.map((b) => b.status).sort()).toEqual(["outbid", "verified"])
  })

  it("a lower re-bid by the leader does not move the price", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    await processBid(payload(auction, 1000, "n1"), db, SERVER) // price 100
    await processBid(payload(auction, 600, "n2"), db, SERVER) // same bidder, lower max

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.max_amount).toBe(1000)
    expect(verified[0]!.current_amount).toBe(100) // unchanged
  })

  it("three bidders: price is driven by the top two maxes", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    await processBid(payload(auction, 500, "n1", "05a"), db, SERVER)
    await processBid(payload(auction, 300, "n2", "05b"), db, SERVER) // price 310
    await processBid(payload(auction, 2000, "n3", "05c"), db, SERVER) // max 2000

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.bidder_npub).toBe("05c")
    expect(verified[0]!.current_amount).toBe(510) // min(2000, 500+10)
  })

  it("immediately settles at buy_now_price when a max reaches it", async () => {
    const auction = makeAuction({ buy_now_price: 1000 })
    await db.saveAuction(auction)
    const result = await processBid(payload(auction, 1500, "n3"), db, SERVER)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.buyNow).toBe(true)
      expect(result.current_amount).toBe(1000) // buy-now price, not the max
    }
    const settled = (await db.getAuction("a1"))!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe(BIDDER)
    expect(settled.winning_amount).toBe(1000) // pays buy-now, not the max
    const bid = (await db.getVerifiedBids("a1"))[0]!
    expect(bid.current_amount).toBe(1000)
  })

  it("does not settle early for a normal high bid below buy_now_price", async () => {
    const auction = makeAuction({ buy_now_price: 1000 })
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 500, "n4"), db, SERVER)
    expect(result.ok).toBe(true)
    expect((await db.getAuction("a1"))!.state).toBe("ACTIVE")
  })

  it("extends the auction by 5 minutes for a bid in the last 5 minutes (anti-sniping)", async () => {
    const endTime = Date.now() + 60_000 // 1 minute left
    const auction = makeAuction({ end_time: endTime })
    db.saveAuction(auction)
    await processBid(payload(auction, 300, "n-snipe"), db, SERVER)

    const after = (await db.getAuction("a1"))!
    expect(after.state).toBe("EXTENDED")
    expect(after.end_time).toBe(endTime + 5 * 60_000)
  })

  it("does not extend for a bid earlier than the last 5 minutes", async () => {
    const endTime = Date.now() + 3600_000
    const auction = makeAuction({ end_time: endTime })
    db.saveAuction(auction)
    await processBid(payload(auction, 300, "n-nosnipe"), db, SERVER)

    const after = (await db.getAuction("a1"))!
    expect(after.state).toBe("ACTIVE")
    expect(after.end_time).toBe(endTime)
  })
})

describe("processPendingBid (pre-registration)", () => {
  let db: Db
  beforeEach(async () => {
    db = initDb()
    process.env.ALLOW_TEST_BIDS = "1"
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  afterAll(async () => {
    delete process.env.ALLOW_TEST_BIDS
  })

  it("saves a pending bid that does not affect the leader or standing price", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    // a real leading bid first
    const live = await processBid(payload(auction, 300, "n1"), db, SERVER)
    expect(live.ok).toBe(true)

    const pending = await processPendingBid(payload(auction, 900, "n2", BIDDER2), db, SERVER)
    expect(pending.ok).toBe(true)

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1) // pending is NOT in the verified set
    expect(verified[0]!.bidder_npub).toBe(BIDDER) // leader unchanged
    expect(verified[0]!.current_amount).toBe(100) // standing price unchanged
  })

  it("pending → live upgrade with the same bundle becomes the verified bid", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    const p = payload(auction, 400, "n3", BIDDER2)
    const pending = await processPendingBid(p, db, SERVER)
    expect(pending.ok).toBe(true)

    const live = await processBid(p, db, SERVER)
    expect(live.ok).toBe(true)

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.bidder_npub).toBe(BIDDER2)
    expect(verified[0]!.status).toBe("verified")
    expect(verified[0]!.max_amount).toBe(400)
  })

  it("pending bid never triggers buy-now settlement", async () => {
    const auction = makeAuction({ buy_now_price: 300 })
    await db.saveAuction(auction)
    const pending = await processPendingBid(payload(auction, 500, "n4"), db, SERVER)
    expect(pending.ok).toBe(true)
    const got = await db.getAuction("a1")
    expect(got!.state).toBe("ACTIVE")
  })

  it("pending never downgrades an already-verified bid for the same bundle", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    const p = payload(auction, 400, "n5", BIDDER2)
    // live first, then a stray pending for the same bundle (retry/two tabs)
    const live = await processBid(p, db, SERVER)
    expect(live.ok).toBe(true)
    const pending = await processPendingBid(p, db, SERVER)
    expect(pending.ok).toBe(true)

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.status).toBe("verified") // NOT downgraded to pending
  })

  it("an abandoned pending bid never moves the standing price for later bids", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    // a real leading bid first
    const live = await processBid(payload(auction, 300, "n1"), db, SERVER)
    expect(live.ok).toBe(true)

    // an abandoned pre-registration for a DIFFERENT bidder with a huge max
    const pending = await processPendingBid(payload(auction, 900, "n2", BIDDER2), db, SERVER)
    expect(pending.ok).toBe(true)

    // a later live bid prices against the real maxes only — the pending 900 is ignored
    const later = await processBid(payload(auction, 400, "n3", "05c"), db, SERVER)
    expect(later.ok).toBe(true)

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.bidder_npub).toBe("05c")
    // pending 900 in the engine would give min(400, 400+10)=410; ignored it gives min(400, 300+10)=310
    expect(verified[0]!.current_amount).toBe(310)
  })

  it("rejects reusing a refunded bundle as a pending bid (PROOF_ALREADY_SPENT)", async () => {
    // test://local bypasses the NUT-07 check (verify/index.ts short-circuits
    // for test mints), so use a real-looking mint URL with a stubbed fetch.
    // The URL must be unique per test: checkMintCapabilities caches by URL at
    // module level (INFO_TTL_MS), so a reused URL would hit the cache.
    const mintUrl = `https://mint-spent-${Date.now()}.test`
    const auction = makeAuction({ mint_url: mintUrl })
    await db.saveAuction(auction)

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/v1/info")) {
          return {
            ok: true,
            json: async () => ({
              nuts: {
                "7": { supported: true },
                "8": { supported: true },
                "10": { supported: true },
                "11": { supported: true },
              },
            }),
          }
        }
        if (url.endsWith("/v1/checkstate")) {
          return { ok: true, json: async () => ({ states: [{ state: "SPENT" }] }) }
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const p = { ...payload(auction, 500, "n-spent"), mint_url: mintUrl }
    const result = await processPendingBid(p, db, SERVER)
    expect(result).toEqual({ ok: false, error: "verify error: PROOF_ALREADY_SPENT" })
  })
})

describe("POST /api/bids — response carries the new standing price", async () => {
  let db: Db
  // 64-hex server signing key; its pubkey is placed in the P2PK lock so
  // verifyBid's SERVER_KEY_MISMATCH check passes through the HTTP route.
  const SERVER_KEY_64 = "ab".repeat(32)
  const SERVER_PUB = bytesToHex(schnorr.getPublicKey(hexToBytes(SERVER_KEY_64)))

  function routePayload(auction: Auction, max: number, nonce: string, bidder = BIDDER) {
    const locktime = Math.ceil((auction.end_time + LOCKTIME_MS) / 1000) + 100
    return {
      proofs: [
        {
          id: "keyset1",
          amount: max,
          secret: JSON.stringify([
            "P2PK",
            {
              nonce,
              data: SELLER,
              tags: [
                ["pubkeys", SERVER_PUB, bidder],
                ["n_sigs", "2"],
                ["locktime", String(locktime)],
                ["refund", bidder],
              ],
            },
          ]),
          C: "c",
        },
      ],
      mint_url: "test://local",
      auction_id: auction.id,
      amount: max,
      bidder_pubkey: bidder,
    }
  }

  beforeEach(async () => {
    db = initDb()
    process.env.ALLOW_TEST_BIDS = "1"
  })
  afterAll(async () => {
    delete process.env.ALLOW_TEST_BIDS
  })

  it("returns current_amount on a normal live bid", async () => {
    const { Hono } = await import("hono")
    const app = new Hono()
    app.route("/api", createAuctionRoutes(db, { serverKey: SERVER_KEY_64 }))
    const auction = makeAuction()
    await db.saveAuction(auction)

    const res = await app.request("http://localhost/api/bids", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routePayload(auction, 300, "n1")),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; current_amount?: number }
    expect(body.ok).toBe(true)
    expect(body.current_amount).toBe(100) // first bid stands at start price
  })

  it("returns the buy-now price when a max reaches buy_now_price", async () => {
    const { Hono } = await import("hono")
    const app = new Hono()
    app.route("/api", createAuctionRoutes(db, { serverKey: SERVER_KEY_64 }))
    const auction = makeAuction({ buy_now_price: 1000 })
    await db.saveAuction(auction)

    const res = await app.request("http://localhost/api/bids", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routePayload(auction, 1500, "n3")),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; buyNow?: boolean; current_amount?: number }
    expect(body.ok).toBe(true)
    expect(body.buyNow).toBe(true)
    expect(body.current_amount).toBe(1000)
  })
})
