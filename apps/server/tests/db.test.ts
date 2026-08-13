import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test"
import fs from "node:fs"
import { initDb, type Db } from "../src/db/index.js"
import type { Auction, Bid } from "@cashu-auction/shared"

function legacyAuction(id: string): Auction {
  return {
    id,
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
  }
}

function bid(id: string, max: number): Bid {
  return {
    id,
    auction_id: "a1",
    max_amount: max,
    current_amount: max,
    bidder_npub: "03cafebabe",
    Y: "y",
    received_at: Date.now(),
    status: "verified",
    proof_data: null,
  }
}

describe("db proxy-bidding schema", async () => {
  let db: Db
  const origPath = process.env.DB_PATH
  const testPath = `data/test-proxy-${Date.now()}.db`

  beforeEach(async () => {
    process.env.DB_PATH = testPath
    for (const f of [testPath, `${testPath}-wal`, `${testPath}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    db = initDb()
  })

  afterEach(async () => {
    if (origPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = origPath
  })

  it("migrates a legacy bids table (amount) to max_amount/current_amount", async () => {
    await db.saveAuction(legacyAuction("a1"))

    // Simulate a pre-proxy-bidding database: old column names only.
    await db.exec(
      "ALTER TABLE bids RENAME COLUMN max_amount TO amount; " +
        "ALTER TABLE bids DROP COLUMN current_amount",
    )
    await db.exec(
      `INSERT INTO bids (id, auction_id, amount, bidder_npub, Y, received_at, status)
       VALUES ('legacy1', 'a1', 500, '03cafebabe', 'y', ${Date.now()}, 'verified')`,
    )

    // Re-init → the idempotent migration must rename + backfill.
    db = initDb()

    const migrated = (await db.getBid("legacy1"))!
    expect(migrated.max_amount).toBe(500)
    expect(migrated.current_amount).toBe(500)
  })

  it("getAllBids returns bids of every status", async () => {
    await db.saveAuction(legacyAuction("a1"))
    await db.saveBid({ ...bid("b1", 500), status: "verified" })
    await db.saveBid({ ...bid("b2", 300), status: "outbid" })
    await db.saveBid({ ...bid("b3", 200), status: "refunded" })

    const all = await db.getAllBids("a1")
    expect(all.map((b) => b.status).sort()).toEqual(["outbid", "refunded", "verified"])
  })

  it("getVerifiedBids orders by max_amount DESC and exposes both fields", async () => {
    await db.saveAuction(legacyAuction("a1"))
    await db.saveBid({ ...bid("b1", 500), status: "outbid" })
    await db.saveBid({ ...bid("b2", 800), status: "verified" })

    const verified = await db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.max_amount).toBe(800)
    expect(verified[0]!.current_amount).toBe(800)
  })
})

describe("db shipping text migration", async () => {
  let db: Db
  const origPath = process.env.DB_PATH
  const testPath = `data/test-shipping-${Date.now()}.db`

  beforeEach(async () => {
    process.env.DB_PATH = testPath
    for (const f of [testPath, `${testPath}-wal`, `${testPath}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    db = initDb()
  })

  afterEach(async () => {
    if (origPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = origPath
  })

  it("rewrites legacy shipping option values to neutral wording", async () => {
    await db.saveAuction(legacyAuction("a1"))
    await db.saveAuction(legacyAuction("a2"))
    await db.saveAuction(legacyAuction("a3"))
    // Simulate a pre-migration database: the old option values in raw SQL.
    await db.exec(
      `UPDATE auctions SET shipping = 'Home delivery' WHERE id = 'a1'; ` +
        `UPDATE auctions SET shipping = 'Home delivery (shipping included)' WHERE id = 'a2'; ` +
        `UPDATE auctions SET shipping = 'In-person handoff' WHERE id = 'a3';`,
    )

    // Re-init → the idempotent migration must rewrite the values.
    db = initDb()

    expect((await db.getAuction("a1"))!.shipping).toBe("Courier (buyer pays shipping)")
    expect((await db.getAuction("a2"))!.shipping).toBe("Courier (free shipping)")
    expect((await db.getAuction("a3"))!.shipping).toBe("In-person handover")
  })

  it("leaves free-text and empty shipping values untouched", async () => {
    await db.saveAuction(legacyAuction("a1"))
    await db.saveAuction(legacyAuction("a2"))
    await db.exec(
      `UPDATE auctions SET shipping = 'Ships from EU only' WHERE id = 'a1'; ` +
        `UPDATE auctions SET shipping = '' WHERE id = 'a2';`,
    )

    db = initDb()

    expect((await db.getAuction("a1"))!.shipping).toBe("Ships from EU only")
    expect((await db.getAuction("a2"))!.shipping).toBe("")
  })
})
