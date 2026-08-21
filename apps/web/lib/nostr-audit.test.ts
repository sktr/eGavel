import { describe, it, expect } from "vitest"
import { buildBidMirror } from "./nostr-audit"

describe("buildBidMirror", () => {
  it("contains hash and standing, no max/secret", () => {
    const ev = buildBidMirror({
      auctionId: "egavel-1",
      bidderNostrPubkey: "a".repeat(64),
      bundleHash: "b".repeat(64),
      standing: 1200,
    })
    expect(ev.tags.find((t) => t[0] === "hash")?.[1]).toBe("b".repeat(64))
    expect(ev.content).toBe("1200")
    expect(JSON.stringify(ev)).not.toContain("secret")
  })
})
