import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex.js";

export interface Nip98Event {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  id?: string
  sig?: string
}

/** NIP-01 canonical event id: sha256 of the serialized array (no spaces). */
export function eventId(event: Pick<Nip98Event, "pubkey" | "created_at" | "kind" | "tags" | "content">): string {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  return bytesToHex(sha256(new TextEncoder().encode(serialized)))
}

export function verifyNip98Event(input: unknown):
  | { ok: true; nostrPubkey: string; content: string }
  | { ok: false; error: string } {
  const event = input as Nip98Event | null
  if (!event || typeof event !== "object") return { ok: false, error: "invalid event" }
  if (event.kind !== 27235) return { ok: false, error: "NOT_NIP98" }
  if (typeof event.pubkey !== "string" || !/^[0-9a-fA-F]{64}$/.test(event.pubkey)) return { ok: false, error: "INVALID_PUBKEY" }
  if (typeof event.content !== "string") return { ok: false, error: "INVALID_CONTENT" }
  if (typeof event.sig !== "string" || !/^[0-9a-fA-F]{128}$/.test(event.sig)) return { ok: false, error: "INVALID_SIG" }
  const id = eventId(event)
  try {
    // NIP-01 signs the sha256 of the serialized event (the event id digest).
    // Verify against the raw digest bytes — identical to nostr-tools' verifyEvent:
    // schnorr.verify(hexToBytes(sig), hexToBytes(hash), hexToBytes(pubkey)).
    const ok = schnorr.verify(hexToBytes(event.sig), hexToBytes(id), hexToBytes(event.pubkey))
    if (!ok) return { ok: false, error: "BAD_SIGNATURE" }
  } catch {
    return { ok: false, error: "BAD_SIGNATURE" }
  }
  return { ok: true, nostrPubkey: event.pubkey, content: event.content }
}
