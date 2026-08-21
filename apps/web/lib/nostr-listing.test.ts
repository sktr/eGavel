import { describe, it, expect } from "vitest"
import { buildListingEvent } from "./nostr-listing"

describe("buildListingEvent", () => {
  it("maps buy_now ?? start to price, includes reserve/buy_now and expiration", () => {
    const ev = buildListingEvent({
      auctionId: "abc123",
      item: "Leica M3",
      description: "CLA done",
      startPrice: 1000,
      reservePrice: 2000,
      buyNowPrice: 5000,
      endTime: 1700000000000,
      category: "cameras",
      imageUrls: ["https://blossom.primal.net/abc.jpg"],
      sellerNostrPubkey: "b".repeat(64),
    })
    expect(ev.kind).toBe(30402)
    expect(ev.tags.find((t) => t[0] === "d")?.[1]).toBe("egavel-abc123")
    expect(ev.tags.find((t) => t[0] === "price")?.[1]).toBe("5000")
    expect(ev.tags.find((t) => t[0] === "reserve")?.[1]).toBe("2000")
    expect(ev.tags.find((t) => t[0] === "expiration")?.[1]).toBe(String(Math.floor(1700000000000 / 1000)))
    expect(ev.tags.filter((t) => t[0] === "image").length).toBe(1)
  })
  it("falls back to start_price when buy_now absent", () => {
    const ev = buildListingEvent({
      auctionId: "x",
      item: "a",
      description: "d",
      startPrice: 999,
      endTime: 1700000000000,
      imageUrls: [],
      sellerNostrPubkey: "c".repeat(64),
    })
    expect(ev.tags.find((t) => t[0] === "price")?.[1]).toBe("999")
  })
})
