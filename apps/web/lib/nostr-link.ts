import { apiUrl } from "./api";
import { signSecretHex } from "./claim";

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
