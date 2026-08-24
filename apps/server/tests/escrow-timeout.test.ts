import { describe, it, expect, beforeEach } from "vitest"
import { initDb, type Db } from "../src/db/index.js"
import { settleIfDue } from "../src/lib/settle.js"
import { ESCROW_TIMEOUT_MS } from "../src/lib/escrow.js"
import type { Auction } from "@egavel/shared"

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
    state: "SETTLED",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: "03cafebabe",
    winning_amount: 100,
    mint_url: "https://mint.example",
    claimed: false,
    ...overrides,
  }
}

describe("escrow timeout handling", () => {
  let db: Db
  beforeEach(() => {
    db = initDb()
  })

  it("preserves escrow row when shipped=true and timeout exceeded", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    await db.saveEscrow({
      auction_id: "a1",
      shipped: 1,
      proofs_data: JSON.stringify({ proofs: [], mint_url: "https://mint.example", amount: 100 }),
      created_at: Date.now() - ESCROW_TIMEOUT_MS - 1,
    })

    const settled = await settleIfDue(db, auction)
    expect(settled.state).toBe("SETTLED")
    expect(await db.getEscrow("a1")).not.toBeNull()
  })

  it("deletes escrow row when shipped=false and timeout exceeded", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    await db.saveEscrow({
      auction_id: "a1",
      shipped: 0,
      proofs_data: JSON.stringify({ proofs: [], mint_url: "https://mint.example", amount: 100 }),
      created_at: Date.now() - ESCROW_TIMEOUT_MS - 1,
    })

    const settled = await settleIfDue(db, auction)
    expect(settled.state).toBe("SETTLED")
    expect(await db.getEscrow("a1")).toBeNull()
  })

  it("does not delete escrow before timeout", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)
    await db.saveEscrow({
      auction_id: "a1",
      shipped: 1,
      proofs_data: JSON.stringify({ proofs: [], mint_url: "https://mint.example", amount: 100 }),
      created_at: Date.now(),
    })

    const settled = await settleIfDue(db, auction)
    expect(settled.state).toBe("SETTLED")
    expect(await db.getEscrow("a1")).not.toBeNull()
  })

  it("skips timeout processing for non-SETTLED auctions", async () => {
    const auction = makeAuction({ state: "ACTIVE" })
    await db.saveAuction(auction)
    await db.saveEscrow({
      auction_id: "a1",
      shipped: 1,
      proofs_data: JSON.stringify({ proofs: [], mint_url: "https://mint.example", amount: 100 }),
      created_at: Date.now() - ESCROW_TIMEOUT_MS - 1,
    })

    await settleIfDue(db, auction)
    expect(await db.getEscrow("a1")).not.toBeNull()
  })

  it("skips timeout when no escrow exists", async () => {
    const auction = makeAuction()
    await db.saveAuction(auction)

    const settled = await settleIfDue(db, auction)
    expect(settled.state).toBe("SETTLED")
    expect(await db.getEscrow("a1")).toBeNull()
  })
})
