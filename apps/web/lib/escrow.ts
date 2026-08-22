import { apiUrl } from "./api";
import { signSecretHex } from "./claim";

export interface EscrowState {
  auction_id: string; stage: number; status: string;
  tracking_number: string | null; tracking_kind: string | null;
  migrated_at: number | null; created_at: number; proofs_data: string;
  stage1_expired?: boolean;
}
export async function fetchEscrow(auctionId: string, partyPubkey: string, partySkHex: string, apiBase?: string): Promise<EscrowState> {
  const sig = signSecretHex(`escrow-view:${auctionId}`, partySkHex);
  const res = await fetch(apiUrl(`/auctions/${auctionId}/escrow?party_pubkey=${partyPubkey}&party_sig=${sig}`, apiBase), { cache:"no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const msg = body.error ?? `escrow fetch failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<EscrowState>;
}
export async function reportTracking(auctionId: string, trackingNumber: string, sellerPubkey: string, sellerSkHex: string, apiBase?: string) {
  const sig = signSecretHex(`tracking:${auctionId}:${trackingNumber}`, sellerSkHex);
  const res = await fetch(apiUrl(`/auctions/${auctionId}/tracking`, apiBase),{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ tracking_number: trackingNumber, seller_pubkey: sellerPubkey, seller_sig: sig }) });
  if (!res.ok) throw new Error((await res.json().catch(()=>({})) as {error?:string}).error ?? "tracking failed");
  return res.json();
}
export async function confirmReceipt(auctionId: string, winnerPubkey: string, winnerSkHex: string, proofsData: string, apiBase?: string) {
  const bundle = JSON.parse(proofsData) as { proofs: { secret:string }[] };
  const winnerSig = signSecretHex(`confirm:${auctionId}`, winnerSkHex);
  const secretSigs = bundle.proofs.map(p=> signSecretHex(p.secret, winnerSkHex));
  const res = await fetch(apiUrl(`/auctions/${auctionId}/confirm-receipt`, apiBase),{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: winnerPubkey, winner_sig: winnerSig, secret_sigs: secretSigs }) });
  if (!res.ok) throw new Error((await res.json().catch(()=>({})) as {error?:string}).error ?? "confirm failed");
  return res.json();
}
