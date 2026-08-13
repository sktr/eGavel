import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test"
import { Hono } from "hono"
import { generateSecretKey, getPublicKey } from "nostr-tools"
import { hexToBytes } from "nostr-tools/utils"
import { initDb, type Db } from "../src/db/index.js"
import { validateClaim, computeClaimSplit } from "../src/claim.js"
import { createAuctionRoutes } from "../src/routes/auctions.js"
import { signSecret, verifySecretSignature } from "../src/lib/schnorr.js"
import type { Auction, Bid } from "@cashu-auction/shared"

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
    state: "SETTLED",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: BIDDER,
    winning_amount: 500,
    mint_url: "https://mint.example",
    ...overrides,
  }
}

function makeBid(overrides: Partial<Bid> = {}): Bid {
  const secret = JSON.stringify([
    "P2PK",
    {
      nonce: "n1",
      data: SELLER,
      tags: [
        ["pubkeys", SERVER, BIDDER],
        ["n_sigs", "2"],
        ["locktime", String(Math.floor(Date.now() / 1000) + 3600)],
        ["refund", BIDDER],
      ],
    },
  ])
  return {
    id: "a1-y",
    auction_id: "a1",
    max_amount: 500,
    current_amount: 500,
    bidder_npub: BIDDER,
    Y: "y",
    received_at: Date.now(),
    status: "verified",
    proof_data: JSON.stringify({
      proofs: [{ keyset_id: "ks1", C: "c", secret, amount: 500 }],
      mint_url: "https://mint.example",
      amount: 500,
    }),
    ...overrides,
  }
}

describe("validateClaim", async () => {
  it("accepts the seller for a settled auction with a winner", async () => {
    const result = validateClaim(makeAuction(), makeBid(), SELLER)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Array.isArray(result.winningSecrets)).toBe(true)
      expect(result.winningSecrets.length).toBe(1)
    }
  })

  it("rejects a non-seller claimant", async () => {
    const result = validateClaim(makeAuction(), makeBid(), "02attacker")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("NOT_SELLER")
  })

  it("rejects when the auction is not settled", async () => {
    const result = validateClaim(makeAuction({ state: "ACTIVE" }), makeBid(), SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("NOT_SETTLED")
  })

  it("rejects when there is no winner", async () => {
    const result = validateClaim(makeAuction({ winner_npub: null }), makeBid(), SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("NO_WINNER")
  })

  it("rejects when locktime has already passed", async () => {
    const bid = makeBid()
    const bundle = JSON.parse(bid.proof_data!) as {
      proofs: { secret: string }[]
    }
    // secret with locktime in the past
    bundle.proofs[0]!.secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n2",
        data: SELLER,
        tags: [
          ["pubkeys", SERVER, BIDDER],
          ["n_sigs", "2"],
          ["locktime", String(Math.floor(Date.now() / 1000) - 60)],
          ["refund", BIDDER],
        ],
      },
    ])
    bid.proof_data = JSON.stringify(bundle)
    const result = validateClaim(makeAuction(), bid, SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("CLAIM_EXPIRED")
  })

  it("rejects a winning bid with no proof_data (NO_PROOF)", async () => {
    const result = validateClaim(makeAuction(), makeBid({ proof_data: null }), SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("NO_PROOF")
  })

  it("rejects a winning bid with unparseable proof_data (INVALID_PROOF)", async () => {
    const result = validateClaim(makeAuction(), makeBid({ proof_data: "not-json" }), SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("INVALID_PROOF")
  })

  it("rejects a winning bid whose proof_data parses but has no secret (INVALID_PROOF)", async () => {
    const result = validateClaim(makeAuction(), makeBid({ proof_data: "{}" }), SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("INVALID_PROOF")
  })
})

describe("bid-list endpoints (max secrecy)", async () => {
  let db: Db
  let app: Hono

  beforeEach(async () => {
    db = initDb()
    await db.saveAuction(makeAuction({ state: "ACTIVE" }))
    await db.saveBid(makeBid()) // verified leader, max_amount 500
    await db.saveBid({ ...makeBid({ id: "a1-y2", bidder_npub: "05outbid", status: "outbid" }), current_amount: 310 })
    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
  })

  it("never exposes max_amount, Y, or proof_data on /auctions/:id/bids", async () => {
    const res = await app.request("http://localhost/api/auctions/a1/bids")
    expect(res.status).toBe(200)
    const bids = (await res.json()) as Record<string, unknown>[]
    expect(bids.length).toBeGreaterThan(0)
    for (const b of bids) {
      expect(b).not.toHaveProperty("max_amount")
      expect(b).not.toHaveProperty("Y")
      expect(b).not.toHaveProperty("proof_data")
      expect(typeof b.current_amount).toBe("number")
    }
  })

  it("never exposes max_amount on /bids (own bid history)", async () => {
    const res = await app.request("http://localhost/api/bids?bidder_pubkey=03cafebabe")
    expect(res.status).toBe(200)
    const bids = (await res.json()) as Record<string, unknown>[]
    for (const b of bids) {
      expect(b).not.toHaveProperty("max_amount")
    }
  })
})

describe("POST /api/auctions (create listing, HTTP-direct)", async () => {
  let db: Db
  let app: Hono

  beforeEach(async () => {
    db = initDb()
    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
  })

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      item: "test item",
      description: "desc",
      start_price: 100,
      end_time: Date.now() + 3600_000,
      seller_pubkey: SELLER,
      mint_url: "https://mint.example",
      ...overrides,
    }
  }

  it("creates an auction with a generated id and saves it to the DB", async () => {
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody()),
    })
    expect(res.status).toBe(200)
    const auction = (await res.json()) as Auction
    expect(auction.id).toMatch(new RegExp(`^${SELLER}-`))
    expect(auction.state).toBe("ACTIVE")
    expect(auction.seller_pubkey).toBe(SELLER)
    expect(auction.start_price).toBe(100)
    expect((await db.getAuction(auction.id))?.item).toBe("test item")
  })

  it("passes through optional fields (reserve, buy-now, category, image)", async () => {
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validBody({
          reserve_price: 500,
          buy_now_price: 1000,
          category: "art",
          condition: "New",
          shipping: "home delivery",
          image: "https://example.com/x.webp",
        }),
      ),
    })
    expect(res.status).toBe(200)
    const auction = (await res.json()) as Auction
    expect(auction.reserve_price).toBe(500)
    expect(auction.buy_now_price).toBe(1000)
    expect(auction.category).toBe("art")
    expect(auction.shipping).toBe("home delivery")
    expect(auction.image).toBe("https://example.com/x.webp")
  })

  it("rejects invalid input (missing item / bad price / past end / no seller)", async () => {
    const bad = [
      validBody({ item: "" }),
      validBody({ description: "" }),
      validBody({ start_price: 0 }),
      validBody({ end_time: Date.now() - 1000 }),
      validBody({ seller_pubkey: "" }),
      validBody({ mint_url: "" }),
    ]
    for (const body of bad) {
      const res = await app.request("http://localhost/api/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
    }
  })
})

describe("POST /api/auctions/:id/shipping (Schnorr-signed payload)", async () => {
  let db: Db
  let app: Hono
  let winnerSkHex: string
  let winnerPubkey: string

  beforeEach(async () => {
    db = initDb()
    winnerSkHex = Buffer.from(generateSecretKey()).toString("hex")
    winnerPubkey = getPublicKey(hexToBytes(winnerSkHex))
    await db.saveAuction(makeAuction({ state: "SETTLED", winner_npub: winnerPubkey }))
    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
  })

  function shippingBody(address: string, note: string | null, skHex: string, pubkey: string) {
    const content = JSON.stringify({ auction_id: "a1", address, note })
    return {
      auction_id: "a1",
      address,
      note,
      pubkey,
      sig: signSecret(content, skHex),
    }
  }

  it("accepts a Schnorr-signed shipping payload from the winner", async () => {
    const res = await app.request("http://localhost/api/auctions/a1/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shippingBody("Tokyo", null, winnerSkHex, winnerPubkey)),
    })
    expect(res.status).toBe(200)
    expect((await db.getShipping("a1"))?.address).toBe("Tokyo")
  })

  it("rejects a signature from a non-winner (NOT_WINNER)", async () => {
    const otherSkHex = Buffer.from(generateSecretKey()).toString("hex")
    const otherPubkey = getPublicKey(hexToBytes(otherSkHex))
    const res = await app.request("http://localhost/api/auctions/a1/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shippingBody("Osaka", null, otherSkHex, otherPubkey)),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("NOT_WINNER")
  })

  it("rejects a tampered payload (INVALID_SIGNATURE)", async () => {
    const body = shippingBody("Tokyo", null, winnerSkHex, winnerPubkey)
    body.address = "Hacked" // tampered payload
    const res = await app.request("http://localhost/api/auctions/a1/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
    const parsed = (await res.json()) as { error: string }
    expect(parsed.error).toBe("INVALID_SIGNATURE")
  })
})

describe("lazy settle on read", async () => {
  let db: Db
  let app: Hono

  beforeEach(async () => {
    db = initDb()
    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
  })

  it("settles a past-due auction when it is fetched", async () => {
    await db.saveAuction(makeAuction({ state: "ACTIVE", end_time: Date.now() - 60_000 }))
    const res = await app.request("http://localhost/api/auctions/a1")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Auction
    expect(body.state).toBe("SETTLED")
  })

  it("settles past-due auctions in the list, leaving live ones active", async () => {
    await db.saveAuction(makeAuction({ id: "a1", state: "ACTIVE", end_time: Date.now() - 60_000 }))
    await db.saveAuction(makeAuction({ id: "a2", state: "ACTIVE", end_time: Date.now() + 3600_000 }))
    const res = await app.request("http://localhost/api/auctions")
    const body = (await res.json()) as Auction[]
    expect(body.find((a) => a.id === "a1")!.state).toBe("SETTLED")
    expect(body.find((a) => a.id === "a2")!.state).toBe("ACTIVE")
  })
})

describe("change-return route", async () => {
  let db: Db
  let app: Hono

  beforeEach(async () => {
    db = initDb()
    process.env.SERVER_PRIVATE_KEY = "ab".repeat(32)
    await db.saveAuction(makeAuction({ state: "SETTLED", winner_npub: BIDDER }))
    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
  })

  afterEach(async () => {
    delete process.env.SERVER_PRIVATE_KEY
  })

  it("returns the stored change proofs to the winner", async () => {
    await db.saveChange(
      "a1",
      BIDDER,
      200,
      JSON.stringify([{ keyset_id: "ks1", C: "c", secret: "s", amount: 200 }]),
    )
    const res = await app.request(
      `http://localhost/api/auctions/a1/change?bidder_pubkey=${BIDDER}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { proofs: unknown[]; amount: number; mint_url: string }
    expect(body.amount).toBe(200)
    expect(body.proofs).toHaveLength(1)
    expect(body.mint_url).toBe("https://mint.example")
  })

  it("rejects a non-winner requesting the change", async () => {
    await db.saveChange(
      "a1",
      BIDDER,
      200,
      JSON.stringify([{ keyset_id: "ks1", C: "c", secret: "s", amount: 200 }]),
    )
    const res = await app.request(
      "http://localhost/api/auctions/a1/change?bidder_pubkey=02attacker",
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("NOT_BIDDER")
  })

  it("returns NO_CHANGE when nothing is stored", async () => {
    const res = await app.request(
      `http://localhost/api/auctions/a1/change?bidder_pubkey=${BIDDER}`,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("NO_CHANGE")
  })
})

describe("computeClaimSplit (proxy-bidding change return)", async () => {
  it("splits locked max into seller, fee, and winner change", async () => {
    // locked 1000 (the max), winning 800, 5% fee
    const split = computeClaimSplit(1000, 800, 500)
    expect(split).toEqual({ sellerNet: 759, fee: 40, change: 200, reserveFee: 1 })
    expect(split.sellerNet + split.fee + split.change + split.reserveFee).toBe(1000)
  })

  it("no change when the winner locked exactly the winning amount", async () => {
    const split = computeClaimSplit(500, 500, 500)
    expect(split.change).toBe(0)
    expect(split.sellerNet + split.fee + split.change + split.reserveFee).toBe(500)
  })

  it("buy-now: returns the excess above buy_now_price to the winner", async () => {
    // locked 1500, winning (buy-now) 1000, 5% fee
    const split = computeClaimSplit(1500, 1000, 500)
    expect(split).toEqual({ sellerNet: 949, fee: 50, change: 500, reserveFee: 1 })
    expect(split.sellerNet + split.fee + split.change + split.reserveFee).toBe(1500)
  })

  it("never returns negative change", async () => {
    const split = computeClaimSplit(100, 500, 500) // defensive: winning > locked
    expect(split.change).toBe(0)
    expect(split.sellerNet).toBeGreaterThanOrEqual(0)
  })
})

describe("co-sign route", async () => {
  let db: Db
  let app: Hono
  let sellerSk: Uint8Array
  let sellerPubkey: string
  let serverSkHex: string
  let serverPubkeyXOnly: string

  beforeEach(async () => {
    db = initDb()
    sellerSk = generateSecretKey()
    sellerPubkey = getPublicKey(sellerSk)
    serverSkHex = Buffer.from(generateSecretKey()).toString("hex")
    serverPubkeyXOnly = getPublicKey(hexToBytes(serverSkHex))
    process.env.SERVER_PRIVATE_KEY = serverSkHex

    const auction = makeAuction({ seller_pubkey: sellerPubkey, state: "SETTLED", winner_npub: BIDDER })
    await db.saveAuction(auction)
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "route1",
        data: sellerPubkey,
        tags: [
          ["pubkeys", SERVER, BIDDER],
          ["n_sigs", "2"],
          ["locktime", String(Math.floor(Date.now() / 1000) + 3600)],
          ["refund", BIDDER],
        ],
      },
    ])
    await db.saveBid({
      id: "a1-y",
      auction_id: "a1",
      max_amount: 500,
      current_amount: 500,
      bidder_npub: BIDDER,
      Y: "y",
      received_at: Date.now(),
      status: "verified",
      proof_data: JSON.stringify({
        proofs: [{ keyset_id: "ks1", C: "c", secret, amount: 500 }],
        mint_url: "https://mint.example",
        amount: 500,
      }),
    })

    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
  })

  afterEach(async () => {
    delete process.env.SERVER_PRIVATE_KEY
  })

  it("co-signs the winning secret with a valid seller signature", async () => {
    const bundle = JSON.parse((await db.getBid("a1-y"))!.proof_data!) as {
      proofs: { secret: string }[]
    }
    const winningSecret = bundle.proofs[0]!.secret
    const sellerSig = signSecret(winningSecret, Buffer.from(sellerSk).toString("hex"))
    const res = await app.request("http://localhost/api/auctions/a1/co-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets: [winningSecret], seller_sigs: [sellerSig] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { server_sigs: string[] }
    expect(body.server_sigs).toHaveLength(1)
    expect(verifySecretSignature(body.server_sigs[0]!, winningSecret, serverPubkeyXOnly)).toBe(true)
  })

  it("rejects a wrong secret with INVALID_MSG", async () => {
    const bundle = JSON.parse((await db.getBid("a1-y"))!.proof_data!) as {
      proofs: { secret: string }[]
    }
    const winningSecret = bundle.proofs[0]!.secret
    const sellerSig = signSecret(winningSecret, Buffer.from(sellerSk).toString("hex"))
    const res = await app.request("http://localhost/api/auctions/a1/co-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets: ["not-the-winning-secret"], seller_sigs: [sellerSig] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("INVALID_MSG")
  })
})
