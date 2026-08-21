import type { EventTemplate } from "nostr-tools"

export function buildBidMirror(input: {
  auctionId: string
  bidderNostrPubkey: string
  bundleHash: string
  standing: number
}): EventTemplate {
  return {
    kind: 1021,
    content: String(input.standing),
    tags: [
      ["e", input.auctionId],
      ["p", input.bidderNostrPubkey],
      ["hash", input.bundleHash],
      ["t", "egavel-bid"],
    ],
    created_at: Math.floor(Date.now() / 1000),
  }
}
