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
 * Sign with the in-app key and publish a Nostr event. The SAME key is used
 * for creating auctions, bids, and identity, so the audit log stays coherent:
 * event pubkey = seller P2PK key = wallet key.
 */
export async function publishEventWithIdentity(
  template: EventTemplate,
  identity: Identity,
  relays?: string[],
): Promise<void> {
  if (!identity.secretKey) {
    throw new Error("no signing key available")
  }
  await publishEvent(template, identity.secretKey, relays)
}
