import { describe, it, expect, vi, afterEach } from "vitest"
import { buildListingEvent, buildListingDeletionEvent, deleteBlossomImages } from "./nostr-listing"

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

describe("buildListingDeletionEvent", () => {
  it("is kind 5 with an a tag pointing at the addressable listing", () => {
    const ev = buildListingDeletionEvent({ sellerNostrPubkey: "b".repeat(64), auctionId: "abc123" })
    expect(ev.kind).toBe(5)
    expect(ev.tags.find((t) => t[0] === "a")?.[1]).toBe(`30402:${"b".repeat(64)}:egavel-abc123`)
  })
})

describe("deleteBlossomImages", () => {
  afterEach(() => vi.restoreAllMocks())

  it("DELETEs known Blossom URLs with a signed auth header and skips others", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }) as unknown as Response)
    const signer = { signEvent: async (t: unknown) => ({ ...(t as object), id: "x", sig: "s" }) }
    await deleteBlossomImages(
      [
        `https://blossom.primal.net/${"a".repeat(64)}.jpg`,
        "https://example.com/not-blossom.jpg",
        "https://unknown.host/${'a'.repeat(64)}".replace("${'a'.repeat(64)}", "a".repeat(64)),
        "https://blossom.primal.net/not-a-hash",
      ],
      signer,
    )
    const calls = fetchSpy.mock.calls.filter(([u, init]) => (init as RequestInit)?.method === "DELETE")
    expect(calls.length).toBe(1)
    expect(String(calls[0]![0])).toBe(`https://blossom.primal.net/${"a".repeat(64)}`)
    const headers = (calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^Nostr /)
  })

  it("does not throw when the server errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    const signer = { signEvent: async (t: unknown) => ({ ...(t as object), id: "x", sig: "s" }) }
    await expect(
      deleteBlossomImages([`https://blossom.primal.net/${"a".repeat(64)}`], signer),
    ).resolves.toBeUndefined()
  })
})
