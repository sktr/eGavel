import { SimplePool } from "nostr-tools/pool"
import { finalizeEvent } from "nostr-tools"
import { nip19 } from "nostr-tools"
import { hexToBytes } from "nostr-tools/utils"
import type { EventTemplate } from "nostr-tools"

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"]

export interface Publisher {
  publishSettlement(
    auctionId: string,
    sellerPubkey: string,
    winnerNpub: string | null,
    amount: number,
    bidsChecked: number,
  ): void
  publishBid(
    auctionId: string,
    sellerPubkey: string,
    bidderNpub: string,
    amount: number,
    Y: string,
    receivedAt: number,
  ): void
}

function getSigningKey(): Uint8Array | null {
  const key = process.env.NOSTR_PRIVATE_KEY
  if (!key) return null
  if (!key.startsWith("nsec")) return hexToBytes(key)
  const decoded = nip19.decode(key)
  return decoded.data as Uint8Array
}

export function createPublisher(): Publisher {
  const relays = process.env.NOSTR_RELAYS
    ? process.env.NOSTR_RELAYS.split(",").map((s) => s.trim())
    : DEFAULT_RELAYS

  const pool = new SimplePool()

  function signAndPublish(template: EventTemplate) {
    const key = getSigningKey()
    if (!key) {
      console.warn("NOSTR_PRIVATE_KEY not set, skipping publish")
      return
    }
    try {
      const signed = finalizeEvent(template, key)
      const pubs = pool.publish(relays, signed)
      pubs.forEach((p) => p.catch(() => {}))
    } catch (err) {
      console.error("publish failed", err)
    }
  }

  return {
    publishSettlement(
      auctionId: string,
      sellerPubkey: string,
      winnerNpub: string | null,
      amount: number,
      bidsChecked: number,
    ) {
      const aTag = `39000:${sellerPubkey}:${auctionId}`
      const tags: string[][] = [["a", aTag]]
      if (winnerNpub) {
        tags.push(["p", winnerNpub])
      }
      tags.push(["winner_amount", String(amount)])

      signAndPublish({
        kind: 39003,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify({
          bids_checked: bidsChecked,
          settled_at: Date.now(),
        }),
      })
      console.log("published settlement for", auctionId)
    },

    publishBid(
      auctionId: string,
      sellerPubkey: string,
      bidderNpub: string,
      amount: number,
      Y: string,
      receivedAt: number,
    ) {
      const aTag = `39000:${sellerPubkey}:${auctionId}`
      const tags: string[][] = [
        ["a", aTag],
        ["p", bidderNpub],
        ["Y", Y],
      ]

      signAndPublish({
        kind: 39001,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify({
          amount,
          received_at: receivedAt,
        }),
      })
      console.log("published bid for", auctionId)
    },
  }
}
