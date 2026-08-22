import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex.js";

export interface Nip99Event {
  id?: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

function eventId(event: Pick<Nip99Event, "pubkey" | "created_at" | "kind" | "tags" | "content">): string {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

export function verifyNip99ListingEvent(
  input: unknown,
  expectedAuctionId: string,
  expectedSellerNostrPubkey: string,
): { ok: true; event: Nip99Event } | { ok: false; error: string } {
  const event = input as Nip99Event | null;
  if (!event || typeof event !== "object") return { ok: false, error: "INVALID_EVENT" };
  if (event.kind !== 30402) return { ok: false, error: "NOT_NIP99" };
  if (typeof event.pubkey !== "string" || !/^[0-9a-fA-F]{64}$/.test(event.pubkey)) return { ok: false, error: "INVALID_PUBKEY" };
  if (event.pubkey.toLowerCase() !== expectedSellerNostrPubkey.toLowerCase()) return { ok: false, error: "PUBKEY_MISMATCH" };
  if (!Array.isArray(event.tags)) return { ok: false, error: "INVALID_TAGS" };
  const dTag = event.tags.find((t) => t[0] === "d");
  if (!dTag || dTag[1] !== `egavel-${expectedAuctionId}`) return { ok: false, error: "D_TAG_MISMATCH" };
  if (typeof event.content !== "string") return { ok: false, error: "INVALID_CONTENT" };
  if (typeof event.sig !== "string" || !/^[0-9a-fA-F]{128}$/.test(event.sig)) return { ok: false, error: "INVALID_SIG" };
  const now = Math.floor(Date.now() / 1000);
  if (typeof event.created_at !== "number" || Math.abs(now - event.created_at) > 600) {
    return { ok: false, error: "STALE_EVENT" };
  }
  const id = eventId(event);
  if (typeof event.id === "string" && event.id.toLowerCase() !== id.toLowerCase()) {
    return { ok: false, error: "ID_MISMATCH" };
  }
  try {
    const ok = schnorr.verify(hexToBytes(event.sig), hexToBytes(id), hexToBytes(event.pubkey));
    if (!ok) return { ok: false, error: "BAD_SIGNATURE" };
  } catch {
    return { ok: false, error: "BAD_SIGNATURE" };
  }
  return { ok: true, event };
}
