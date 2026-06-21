"use client"

import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip19,
} from "nostr-tools"
import { hexToBytes, bytesToHex } from "nostr-tools/utils"
import { SimplePool } from "nostr-tools/pool"
import type { EventTemplate } from "nostr-tools"

const STORAGE_KEY = "cashu-auction-nostr-key"

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"]

export function loadOrCreateKey(): {
  secretKey: Uint8Array
  pubkey: string
} {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const bytes = hexToBytes(stored)
    return { secretKey: bytes, pubkey: getPublicKey(bytes) }
  }
  const secretKey = generateSecretKey()
  localStorage.setItem(STORAGE_KEY, bytesToHex(secretKey))
  const pubkey = getPublicKey(secretKey)
  return { secretKey, pubkey }
}

export function getNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey)
}

export async function publishEvent(
  template: EventTemplate,
  secretKey: Uint8Array,
  relays?: string[],
): Promise<void> {
  const pool = new SimplePool()
  const event = finalizeEvent(template, secretKey)
  const target = relays ?? DEFAULT_RELAYS
  await Promise.any(pool.publish(target, event))
}
