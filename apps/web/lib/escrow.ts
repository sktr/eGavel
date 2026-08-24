import { apiUrl } from "./api";
import { signSecretHex } from "./claim";

export interface EscrowState {
  auction_id: string;
  shipped: number;
  created_at: number;
  proofs_data: string;
  timeout_expired: boolean;
}

export async function fetchEscrow(auctionId: string, partyPubkey: string, partySkHex: string, apiBase?: string): Promise<EscrowState> {
  const sig = signSecretHex(`escrow-view:${auctionId}`, partySkHex);
  const res = await fetch(apiUrl(`/auctions/${auctionId}/escrow?party_pubkey=${partyPubkey}&party_sig=${sig}`, apiBase), { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(body.error ?? `escrow fetch failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<EscrowState>;
}

export async function markShipped(auctionId: string, sellerPubkey: string, sellerSkHex: string, apiBase?: string) {
  const sig = signSecretHex(`shipped:${auctionId}`, sellerSkHex);
  const res = await fetch(apiUrl(`/auctions/${auctionId}/shipped`, apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller_pubkey: sellerPubkey, seller_sig: sig }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "shipped failed");
  }
  return res.json();
}

export async function confirmReceipt(auctionId: string, winnerPubkey: string, winnerSkHex: string, apiBase?: string) {
  const sig = signSecretHex(`confirm:${auctionId}`, winnerSkHex);
  const res = await fetch(apiUrl(`/auctions/${auctionId}/confirm`, apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ winner_pubkey: winnerPubkey, winner_sig: sig }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "confirm failed");
  }
  return res.json();
}
