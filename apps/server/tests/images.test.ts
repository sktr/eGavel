import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test"
import fs from "node:fs"
import { initDb, type Db } from "../src/db/index.js"
import type { Auction } from "@cashu-auction/shared"

function auction(id: string, overrides: Partial<Auction> = {}): Auction {
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
    ...overrides,
  }
}

describe("db images column", async () => {
  let db: Db
  const origPath = process.env.DB_PATH
  const testPath = `data/test-images-${Date.now()}.db`

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

  it("round-trips an images array as JSON", async () => {
    const imgs = ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"]
    await db.saveAuction(auction("a1", { images: imgs }))
    const got = (await db.getAuction("a1"))!
    expect(got.images).toEqual(imgs)
    expect(got.image).toBe(imgs[0])
  })

  it("falls back to a renderable legacy image column", async () => {
    await db.saveAuction(auction("a1", { image: "https://example.com/x.webp" }))
    const got = (await db.getAuction("a1"))!
    expect(got.images).toEqual(["https://example.com/x.webp"])
  })

  it("treats a legacy bare filename as no image", async () => {
    await db.saveAuction(auction("a1", { image: "photo.jpg" }))
    const got = (await db.getAuction("a1"))!
    expect(got.images).toBeUndefined()
  })

  it("returns images on every read path", async () => {
    const imgs = ["data:image/webp;base64,AAA"]
    await db.saveAuction(auction("a1", { images: imgs }))
    expect((await db.getActiveAuctions())[0]!.images).toEqual(imgs)
    expect((await db.getAllAuctions())[0]!.images).toEqual(imgs)
    expect((await db.getAuctionsBySeller("02deadbeef"))[0]!.images).toEqual(imgs)
  })
})
