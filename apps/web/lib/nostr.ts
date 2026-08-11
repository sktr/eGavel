"use client"

import { finalizeEvent } from "nostr-tools"
import type { EventTemplate, Event } from "nostr-tools"
import { SimplePool } from "nostr-tools/pool"
import type { Identity } from "./identity"

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"]

export async function publishSignedEvent(
  event: Event,
  relays?: string[],
): Promise<void> {
  const pool = new SimplePool()
  const target = relays ?? DEFAULT_RELAYS
  await Promise.any(pool.publish(target, event))
}

export async function publishEvent(
  template: EventTemplate,
  secretKey: Uint8Array,
  relays?: string[],
): Promise<void> {
  const event = finalizeEvent(template, secretKey)
  await publishSignedEvent(event, relays)
}

/**
 * Sign (via NIP-07 if available, otherwise the in-app fallback key) and
 * publish a Nostr event. The SAME identity is used for creating auctions,
 * so seller keys, bids, and the header all share one identity.
 */
export async function publishEventWithIdentity(
  template: EventTemplate,
  identity: Identity,
  relays?: string[],
): Promise<void> {
  if (identity.type === "nip07" && typeof window !== "undefined" && window.nostr) {
    const signed = await window.nostr.signEvent(template)
    const event = {
      ...template,
      id: signed.id,
      sig: signed.sig,
      pubkey: identity.pubkey,
    } as unknown as Event
    await publishSignedEvent(event, relays)
  } else if (identity.secretKey) {
    await publishEvent(template, identity.secretKey, relays)
  } else {
    throw new Error("no signing key available")
  }
}
