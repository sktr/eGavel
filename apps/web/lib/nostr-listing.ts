import type { EventTemplate } from "nostr-tools"
import { nip19 } from "nostr-tools"

export type ListingInput = {
  auctionId: string
  item: string
  description: string
  startPrice: number
  reservePrice?: number
  buyNowPrice?: number
  endTime: number
  category?: string
  imageUrls: string[]
  sellerNostrPubkey: string
}

export function buildListingEvent(input: ListingInput): EventTemplate {
  const price = String(input.buyNowPrice ?? input.startPrice)
  const tags: string[][] = [
    ["d", `egavel-${input.auctionId}`],
    ["title", input.item],
    ["summary", input.description.slice(0, 120)],
    ["price", price, "SAT"],
    ["t", "egavel"],
    ["r", `https://egavel.vercel.app/auctions/${input.auctionId}`],
    ["published_at", String(Math.floor(Date.now() / 1000))],
    ["expiration", String(Math.floor(input.endTime / 1000))],
  ]
  if (input.category) tags.push(["t", input.category])
  for (const url of input.imageUrls) tags.push(["image", url, "", "0"])
  if (input.reservePrice) tags.push(["reserve", String(input.reservePrice)])
  if (input.buyNowPrice) tags.push(["buy_now", String(input.buyNowPrice)])
  tags.push(["auction", "start", String(input.startPrice)])
  tags.push(["auction", "end", String(Math.floor(input.endTime / 1000))])
  return {
    kind: 30402,
    content: `${input.description}\n\n---\nBid on eGavel: https://egavel.vercel.app/auctions/${input.auctionId}`,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

export async function publishListing(
  event: EventTemplate,
  signer: { signEvent: (t: EventTemplate) => Promise<unknown> },
  relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
): Promise<string[]> {
  const signed = await signer.signEvent(event)
  const { SimplePool } = await import("nostr-tools")
  const pool = new SimplePool()
  const pubs = pool.publish(relays, signed as never)
  await Promise.allSettled(pubs)
  pool.close(relays)
  return relays
}

export function listingNaddr(pubkey: string, d: string, relays: string[]): string {
  return nip19.naddrEncode({ pubkey, kind: 30402, identifier: d, relays })
}

/** NIP-09 deletion event (kind 5) for a listing mirror. Tags reference the
 * addressable `a` tag so clients can hide the listing even without its event id. */
export function buildListingDeletionEvent(input: {
  sellerNostrPubkey: string
  auctionId: string
}): EventTemplate {
  return {
    kind: 5,
    content: "deleted listing",
    tags: [["a", `30402:${input.sellerNostrPubkey}:egavel-${input.auctionId}`]],
    created_at: Math.floor(Date.now() / 1000),
  }
}

const BLOSSOM_HOSTS = ["blossom.primal.net", "cdn.nostrcheck.me", "blossom.band"]

/** Best-effort Blossom blob deletion (BUD-02): only for URLs on known Blossom
 * hosts; signs a kind 24242 auth with t:delete + x:<sha256> and DELETEs. */
export async function deleteBlossomImages(
  imageUrls: string[],
  signer: { signEvent: (t: unknown) => Promise<unknown> },
): Promise<void> {
  for (const raw of imageUrls) {
    try {
      const url = new URL(raw)
      if (!BLOSSOM_HOSTS.includes(url.hostname)) continue
      // Blob path is <sha256>[.<ext>] — take the hex portion.
      const hash = url.pathname.split("/").pop()?.split(".")[0] ?? ""
      if (!/^[a-f0-9]{64}$/i.test(hash)) continue
      const now = Math.floor(Date.now() / 1000)
      const auth = await signer.signEvent({
        kind: 24242,
        content: "delete",
        tags: [
          ["t", "delete"],
          ["x", hash],
          ["expiration", String(now + 60)],
        ],
        created_at: now,
      })
      await fetch(`${url.origin}/${hash}`, {
        method: "DELETE",
        headers: { Authorization: `Nostr ${btoa(JSON.stringify(auth))}` },
      })
    } catch {
      // best-effort per-image; continue with the rest
    }
  }
}
