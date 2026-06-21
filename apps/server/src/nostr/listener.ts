import { SimplePool } from "nostr-tools/pool"
import { getPublicKey } from "nostr-tools"
import { nip19, nip59 } from "nostr-tools"
import { hexToBytes } from "nostr-tools/utils"
import type { Event, Filter } from "nostr-tools"
import type { Auction } from "@cashu-auction/shared"
import type { Db } from "../db/index.js"
import type { Publisher } from "./publisher.js"
import { createPublisher } from "./publisher.js"
import { processBid } from "../process-bid.js"
import type { BidPayload } from "../verify/index.js"

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"]

export function parseAuctionEvent(event: Event): Auction | null {
  if (event.kind !== 39000) return null

  const dTag = event.tags.find((t) => t[0] === "d")?.[1]
  if (!dTag) return null

  let content: Record<string, unknown>
  try {
    content = JSON.parse(event.content) as Record<string, unknown>
  } catch {
    return null
  }

  return {
    id: dTag,
    item: String(content.item ?? ""),
    description: String(content.description ?? ""),
    start_price: Number(content.start_price ?? 0),
    end_time: Number(content.end_time ?? 0),
    seller_pubkey: event.pubkey,
    state: "ACTIVE",
    start_time: event.created_at * 1000,
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
  }
}

function getServerPrivkey(): Uint8Array | null {
  const key = process.env.NOSTR_PRIVATE_KEY
  if (!key) return null
  if (key.startsWith("nsec")) {
    const { data } = nip19.decode(key)
    return data as Uint8Array
  }
  return hexToBytes(key)
}

export function createNostrListener(
  db: Db,
  publisher?: Publisher,
) {
  const relays = process.env.NOSTR_RELAYS
    ? process.env.NOSTR_RELAYS.split(",").map((s) => s.trim())
    : DEFAULT_RELAYS

  const pool = new SimplePool()
  const pub = publisher ?? createPublisher()
  let running = false
  let auctionSub: { close: () => void } | null = null
  let dmSub: { close: () => void } | null = null

  const serverPrivkey = getServerPrivkey()
  const serverPubkey = serverPrivkey ? getPublicKey(serverPrivkey) : null

  function handleAuctionEvent(event: Event) {
    if (event.kind !== 39000) return
    const auction = parseAuctionEvent(event)
    if (!auction) return
    const existing = db.getAuction(auction.id)
    if (existing) return
    db.saveAuction(auction)
    console.log("ingested auction", auction.id)
  }

  async function handleGiftWrap(event: Event) {
    if (!serverPrivkey || !serverPubkey) return
    if (event.kind !== 1059) return

    try {
      const rumor = nip59.unwrapEvent(event, serverPrivkey)
      let payload: BidPayload
      try {
        payload = JSON.parse(rumor.content) as BidPayload
      } catch {
        return
      }

      if (!payload.auction_id || !payload.amount) return

      const result = await processBid(payload, db, pub)
      if (result.ok) {
        console.log("verified bid for", payload.auction_id)
      } else {
        console.log("bid rejected", result.error)
      }
    } catch (err) {
      console.log("failed to process gift wrap", err)
    }
  }

  return {
    start() {
      if (running) return
      running = true

      try {
        const auctionFilter: Filter = { kinds: [39000] }
        auctionSub = pool.subscribeMany(relays, auctionFilter, {
          onevent: handleAuctionEvent,
        })

        if (serverPubkey) {
          const dmFilter: Filter = {
            kinds: [1059],
            "#p": [serverPubkey],
          }
          dmSub = pool.subscribeMany(relays, dmFilter, {
            onevent: handleGiftWrap,
          })
          console.log("listening for NIP-17 DMs as", serverPubkey)
        } else {
          console.warn("NOSTR_PRIVATE_KEY not set, skipping NIP-17 DM subscription")
        }

        console.log("nostr listener started on", relays)
      } catch (err) {
        console.error("nostr listener failed", err)
      }
    },

    stop() {
      running = false
      auctionSub?.close()
      dmSub?.close()
      pool.close(relays)
      console.log("nostr listener stopped")
    },
  }
}
