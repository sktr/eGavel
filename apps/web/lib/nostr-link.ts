import { apiUrl } from "./api";
import { signSecretHex } from "./claim";
import { bech32 } from "@scure/base";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex";

export interface LinkEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export function buildLinkEvent(tradingPubkey: string, createdAt = Math.floor(Date.now() / 1000)): LinkEvent {
  return {
    pubkey: "", // filled by the extension
    created_at: createdAt,
    kind: 27235,
    tags: [["u", "https://egavel.vercel.app"], ["method", "LINK"]],
    content: tradingPubkey,
  };
}

export function detectNostrExtension(): boolean {
  return typeof window !== "undefined" && !!((window as { nostr?: unknown }).nostr);
}

export async function linkNostr(
  tradingPubkey: string,
  tradingSkHex: string,
  apiBase?: string,
): Promise<{ ok: true; nostrPubkey: string } | { ok: false; error: string }> {
  const nostr = (window as { nostr?: { getPublicKey?: () => Promise<string>; signEvent?: (e: unknown) => Promise<unknown> } }).nostr;
  if (!nostr?.signEvent) return { ok: false, error: "NO_NIP07" };
  const nostrPubkey = await nostr.getPublicKey!();
  const event = { ...buildLinkEvent(tradingPubkey), pubkey: nostrPubkey };
  const signed = await nostr.signEvent(event);
  const tradingSig = signSecretHex(`link:${tradingPubkey}`, tradingSkHex);
  const res = await fetch(apiUrl("/identity/nostr-link", apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trading_pubkey: tradingPubkey, sig: tradingSig, event: signed }),
  });
  return parseLinkResult(await res.json().catch(() => ({ error: "link failed" })));
}

export async function unlinkNostr(tradingPubkey: string, tradingSkHex: string, apiBase?: string): Promise<{ ok: boolean; error?: string }> {
  const tradingSig = signSecretHex(`unlink:${tradingPubkey}`, tradingSkHex);
  const res = await fetch(apiUrl("/identity/nostr-link", apiBase), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trading_pubkey: tradingPubkey, sig: tradingSig }),
  });
  if (!res.ok) return { ok: false, error: "unlink failed" };
  return { ok: true };
}

/** Read the caller's own link status (signed like /bids). ok:false → not linked. */
export async function fetchNostrLinkStatus(
  tradingPubkey: string,
  tradingSkHex: string,
  apiBase?: string,
): Promise<{ ok: boolean; nostrPubkey?: string; error?: string }> {
  const sig = signSecretHex(`nostr-link:${tradingPubkey}`, tradingSkHex);
  const res = await fetch(
    apiUrl(`/identity/nostr-link?trading_pubkey=${tradingPubkey}&sig=${sig}`, apiBase),
    { cache: "no-store" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "link status failed" };
  }
  const d = (await res.json()) as { ok?: boolean; nostr_pubkey?: string };
  if (d.ok && d.nostr_pubkey) return { ok: true, nostrPubkey: d.nostr_pubkey };
  return { ok: false };
}

export function parseLinkResult(data: unknown): { ok: true; nostrPubkey: string } | { ok: false; error: string } {
  const d = data as { ok?: boolean; nostr_pubkey?: string; error?: string };
  if (d.ok && d.nostr_pubkey) return { ok: true, nostrPubkey: d.nostr_pubkey };
  return { ok: false, error: d.error ?? "link failed" };
}

/** Decode an nsec1... (bech32) to a 64-hex secret key. Throws on invalid input. */
export function decodeNsec(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("nsec1")) {
    if (trimmed.startsWith("ncryptsec1")) throw new Error("NCRYPTSEC_UNSUPPORTED");
    throw new Error("INVALID_NSEC");
  }
  const decoded = bech32.decode(trimmed, false);
  if (decoded.prefix !== "nsec") throw new Error("INVALID_NSEC");
  const bytes = bech32.fromWords(decoded.words);
  if (bytes.length !== 32) throw new Error("INVALID_NSEC");
  return bytesToHex(bytes);
}

/** NIP-01 canonical event id: sha256 of the serialized array (no spaces). Mirrors apps/server/src/lib/nip98.ts eventId(). */
export function nostrEventId(event: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }): string {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

/** Sign a NIP-98 event client-side with an nsec (64-hex). Signature is over the raw 32-byte event-id digest — identical to apps/server/src/lib/nip98.ts verifyNip98Event. */
export async function signLinkEventWithNsec(
  event: { created_at: number; kind: number; tags: string[][]; content: string },
  nsecHex: string,
): Promise<{ id: string; sig: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }> {
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(nsecHex)));
  const full = { ...event, pubkey };
  const id = nostrEventId(full);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(nsecHex)));
  return { ...full, id, sig };
}

/** Link Nostr identity by nsec (no NIP-07 extension): decode, sign the NIP-98 event, POST the same shape linkNostr() posts. */
export async function linkNostrWithNsec(
  tradingPubkey: string,
  tradingSkHex: string,
  nsecInput: string,
  apiBase?: string,
): Promise<{ ok: true; nostrPubkey: string } | { ok: false; error: string }> {
  try {
    const nsecHex = decodeNsec(nsecInput);
    const event = { ...buildLinkEvent(tradingPubkey), created_at: Math.floor(Date.now() / 1000) };
    const signed = await signLinkEventWithNsec(event, nsecHex);
    const tradingSig = signSecretHex(`link:${tradingPubkey}`, tradingSkHex);
    const res = await fetch(apiUrl("/identity/nostr-link", apiBase), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trading_pubkey: tradingPubkey, sig: tradingSig, event: signed }),
    });
    return parseLinkResult(await res.json().catch(() => ({ error: "link failed" })));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
