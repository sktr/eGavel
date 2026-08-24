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

/**
 * Shared escrow resolution flow (confirm/release/refund): the server cannot
 * move 2-of-3 funds alone — it needs the party's REAL signature over every
 * proof secret. So: fetch the escrow proofs via GET /escrow, sign each secret
 * locally with the trading key, then POST them alongside the action's auth
 * signature.
 */
async function signedEscrowAction(
  action: "confirm" | "release" | "refund",
  auctionId: string,
  partyPubkey: string,
  partySkHex: string,
  apiBase?: string,
) {
  const escrow = await fetchEscrow(auctionId, partyPubkey, partySkHex, apiBase);
  let bundle: { proofs?: Array<{ secret?: string }> } = {};
  try {
    bundle = JSON.parse(escrow.proofs_data) as { proofs?: Array<{ secret?: string }> };
  } catch {
    throw new Error("INVALID_PROOF");
  }
  const secrets = (bundle.proofs ?? []).map((p) => String(p.secret));
  if (secrets.length === 0) throw new Error("INVALID_PROOF");
  const partySigs = secrets.map((s) => signSecretHex(s, partySkHex));
  const isSellerAction = action === "release";
  const payload = {
    ...(isSellerAction
      ? { seller_pubkey: partyPubkey }
      : { winner_pubkey: partyPubkey }),
    [isSellerAction ? "seller_sig" : "winner_sig"]: signSecretHex(`${action}:${auctionId}`, partySkHex),
    secrets,
    ...(isSellerAction ? { seller_sigs: partySigs } : { winner_sigs: partySigs }),
  };
  const res = await fetch(apiUrl(`/auctions/${auctionId}/${action}`, apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `${action} failed`);
  }
  return res.json();
}

export async function confirmReceipt(auctionId: string, winnerPubkey: string, winnerSkHex: string, apiBase?: string) {
  return signedEscrowAction("confirm", auctionId, winnerPubkey, winnerSkHex, apiBase);
}

/** Timeout-gated seller self-release: shipped=true and 14 days elapsed. */
export async function releaseEscrow(auctionId: string, sellerPubkey: string, sellerSkHex: string, apiBase?: string) {
  return signedEscrowAction("release", auctionId, sellerPubkey, sellerSkHex, apiBase);
}

/** Timeout-gated winner self-refund: shipped=false and 14 days elapsed. */
export async function refundEscrow(auctionId: string, winnerPubkey: string, winnerSkHex: string, apiBase?: string) {
  return signedEscrowAction("refund", auctionId, winnerPubkey, winnerSkHex, apiBase);
}
