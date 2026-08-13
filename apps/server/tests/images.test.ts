import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test"
import fs from "node:fs"
import { initDb, type Db } from "../src/db/index.js"
import type { Auction } from "@cashu-auction/shared"
import { Hono } from "hono"
import { createAuctionRoutes } from "../src/routes/auctions.js"

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

describe("POST /api/auctions with images", async () => {
  let db: Db
  let app: Hono
  let testPath = ""
  const origPath = process.env.DB_PATH

  beforeEach(async () => {
    testPath = `data/test-images-api-${Date.now()}.db`
    for (const f of [testPath, `${testPath}-wal`, `${testPath}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    process.env.DB_PATH = testPath
    db = initDb()
    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
  })

  afterEach(async () => {
    for (const f of [testPath, `${testPath}-wal`, `${testPath}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    if (origPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = origPath
  })

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      item: "test item",
      description: "desc",
      start_price: 100,
      end_time: Date.now() + 3600_000,
      seller_pubkey: "02deadbeef",
      mint_url: "https://mint.example",
      ...overrides,
    }
  }

  it("persists an images array and derives legacy image", async () => {
    const imgs = ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"]
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody({ images: imgs })),
    })
    expect(res.status).toBe(200)
    const auction = (await res.json()) as Auction
    expect(auction.images).toEqual(imgs)
    expect(auction.image).toBe(imgs[0])
    expect((await db.getAuction(auction.id))?.images).toEqual(imgs)
  })

  it("rejects more than 4 images", async () => {
    const imgs = Array.from({ length: 5 }, (_, i) => `data:image/webp;base64,${i}`)
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody({ images: imgs })),
    })
    expect(res.status).toBe(400)
  })

  it("rejects an oversized image string", async () => {
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody({ images: ["data:image/webp;base64," + "x".repeat(2_000_001)] })),
    })
    expect(res.status).toBe(400)
  })

  it("list endpoints truncate images to the first element", async () => {
    const imgs = ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"]
    await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody({ images: imgs })),
    })
    const list = (await (await app.request("http://localhost/api/auctions")).json()) as Auction[]
    expect(list[0]!.images).toEqual([imgs[0]])
    const active = (await (await app.request("http://localhost/api/auctions?filter=active")).json()) as Auction[]
    expect(active[0]!.images).toEqual([imgs[0]])
  })

  it("detail endpoint returns all images", async () => {
    const imgs = ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"]
    const created = (await (
      await app.request("http://localhost/api/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody({ images: imgs })),
      })
    ).json()) as Auction
    const detail = (await (await app.request(`http://localhost/api/auctions/${created.id}`)).json()) as Auction
    expect(detail.images).toEqual(imgs)
  })
})
