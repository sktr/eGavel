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

describe("db proxy-bidding schema", () => {
  let db: Db
  const origPath = process.env.DB_PATH
  const testPath = `data/test-proxy-${Date.now()}.db`

  beforeEach(() => {
    process.env.DB_PATH = testPath
    for (const f of [testPath, `${testPath}-wal`, `${testPath}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    db = initDb()
  })

  afterEach(() => {
    if (origPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = origPath
  })

  it("migrates a legacy bids table (amount) to max_amount/current_amount", () => {
    db.saveAuction(legacyAuction("a1"))

    // Simulate a pre-proxy-bidding database: old column names only.
    db.exec(
      "ALTER TABLE bids RENAME COLUMN max_amount TO amount; " +
        "ALTER TABLE bids DROP COLUMN current_amount",
    )
    db.prepare(
      `INSERT INTO bids (id, auction_id, amount, bidder_npub, Y, received_at, status)
       VALUES ('legacy1', 'a1', 500, '03cafebabe', 'y', ?, 'verified')`,
    ).run(Date.now())

    // Re-init → the idempotent migration must rename + backfill.
    db = initDb()

    const migrated = db.getBid("legacy1")!
    expect(migrated.max_amount).toBe(500)
    expect(migrated.current_amount).toBe(500)
  })

  it("getAllBids returns bids of every status", () => {
    db.saveAuction(legacyAuction("a1"))
    db.saveBid({ ...bid("b1", 500), status: "verified" })
    db.saveBid({ ...bid("b2", 300), status: "outbid" })
    db.saveBid({ ...bid("b3", 200), status: "refunded" })

    const all = db.getAllBids("a1")
    expect(all.map((b) => b.status).sort()).toEqual(["outbid", "refunded", "verified"])
  })

  it("getVerifiedBids orders by max_amount DESC and exposes both fields", () => {
    db.saveAuction(legacyAuction("a1"))
    db.saveBid({ ...bid("b1", 500), status: "outbid" })
    db.saveBid({ ...bid("b2", 800), status: "verified" })

    const verified = db.getVerifiedBids("a1")
    expect(verified).toHaveLength(1)
    expect(verified[0]!.max_amount).toBe(800)
    expect(verified[0]!.current_amount).toBe(800)
  })
})
