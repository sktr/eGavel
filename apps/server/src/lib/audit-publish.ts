import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex.js";

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"]

export function buildEscrowAuditEvent(
  serverSkHex: string,
  opts: { auctionId: string; status: string; trackingKind?: string; fallbackCosign?: boolean; amount: number }
): { kind:number; content:string; tags:string[][]; created_at:number; pubkey:string; id:string; sig:string } {
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(serverSkHex)));
  const tags: string[][] = [["e", opts.auctionId], ["t","egavel-escrow"], ["status", opts.status]];
  if (opts.trackingKind) tags.push(["tracking", opts.trackingKind]);
  if (opts.fallbackCosign) tags.push(["note","fallback_cosign"]);
  const template = { kind:1022, content: String(opts.amount), tags, created_at: Math.floor(Date.now()/1000), pubkey };
  const serialized = JSON.stringify([0, template.pubkey, template.created_at, template.kind, template.tags, template.content]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(serverSkHex)));
  return { ...template, id, sig };
}
export function publishEscrowAudit(serverSkHex: string | undefined, opts: Parameters<typeof buildEscrowAuditEvent>[1]) {
  if (!serverSkHex || !/^[0-9a-fA-F]{64}$/.test(serverSkHex)) return;
  try { void publishAuditLog(buildEscrowAuditEvent(serverSkHex, opts)); } catch {}
}

export async function publishAuditLog(
  event: unknown,
  relays: string[] = DEFAULT_RELAYS,
): Promise<void> {
  try {
    const { SimplePool } = await import("nostr-tools")
    const pool = new SimplePool()
    const pubs: Promise<string>[] = pool.publish(relays, event as never)
    await Promise.allSettled(pubs)
    pool.close(relays)
  } catch {
    // fire-and-forget: never throw
  }
}
