import { describe, it, expect, beforeEach } from "vite-plus/test"
import type { Auction } from "@cashu-auction/shared"
import { initDb, type Db } from "../src/db/index.js"
import { parseAuctionEvent } from "../src/nostr/listener.js"

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    pubkey: "abc123",
    created_at: Math.floor(Date.now() / 1000) - 60,
    kind: 39000,
    tags: [["d", "auction-1"]],
    content: JSON.stringify({
      item: "test item",
      description: "a test item",
      start_price: 100,
      end_time: Date.now() + 3600_000,
    }),
    sig: "sig123",
    ...overrides,
  }
}

describe("parseAuctionEvent", () => {
  it("parses a valid kind:39000 event into an Auction", () => {
    const event = makeEvent()
    const result = parseAuctionEvent(event)

    expect(result).not.toBeNull()
    expect(result!.id).toBe("auction-1")
    expect(result!.item).toBe("test item")
    expect(result!.description).toBe("a test item")
    expect(result!.start_price).toBe(100)
    expect(result!.seller_pubkey).toBe("abc123")
    expect(result!.state).toBe("ACTIVE")
  })

  it("returns null for non-39000 events", () => {
    const event = makeEvent({ kind: 1 })
    expect(parseAuctionEvent(event)).toBeNull()
  })

  it("returns null if d tag is missing", () => {
    const event = makeEvent({ tags: [] })
    expect(parseAuctionEvent(event)).toBeNull()
  })

  it("returns null if content is not valid JSON", () => {
    const event = makeEvent({ content: "not json" })
    expect(parseAuctionEvent(event)).toBeNull()
  })

  it("sets seller_pubkey from event.pubkey", () => {
    const event = makeEvent({ pubkey: "seller-x" })
    const result = parseAuctionEvent(event)
    expect(result!.seller_pubkey).toBe("seller-x")
  })

  it("sets start_time from event.created_at in milliseconds", () => {
    const event = makeEvent({ created_at: 1_000_000 })
    const result = parseAuctionEvent(event)
    expect(result!.start_time).toBe(1_000_000_000)
  })
})

describe("parseAuctionEvent extended fields", () => {
  it("parses mint_url, reserve_price, buy_now_price and meta", () => {
    const event = makeEvent({
      content: JSON.stringify({
        item: "watch",
        description: "desc",
        start_price: 100,
        reserve_price: 5000,
        buy_now_price: 10000,
        end_time: Date.now() + 3600_000,
        mint_url: "https://mint.example",
        category: "watches",
        condition: "New",
        shipping: "Courier",
        image: "https://img.example/1.png",
      }),
    })
    const result = parseAuctionEvent(event)!
    expect(result.mint_url).toBe("https://mint.example")
    expect(result.reserve_price).toBe(5000)
    expect(result.buy_now_price).toBe(10000)
    expect(result.category).toBe("watches")
    expect(result.condition).toBe("New")
    expect(result.shipping).toBe("Courier")
    expect(result.image).toBe("https://img.example/1.png")
  })

  it("defaults mint_url to empty string and nullable prices to null", () => {
    const result = parseAuctionEvent(makeEvent())!
    expect(result.mint_url).toBe("")
    expect(result.reserve_price).toBeNull()
    expect(result.buy_now_price).toBeNull()
  })
})

describe("listener integration with DB", () => {
  let db: Db

  beforeEach(() => {
    db = initDb()
  })

  it("persists parsed auction to database", () => {
    const event = makeEvent()
    const auction = parseAuctionEvent(event)!
    db.saveAuction(auction)

    const saved = db.getAuction("auction-1")
    expect(saved).not.toBeNull()
    expect(saved!.item).toBe("test item")
  })
})
