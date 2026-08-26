import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex";
import { Amount } from "@cashu/cashu-ts";
import { storeProofsInWallet } from "./wallet";
import { buildWallet, loadMintCached } from "./deterministic-wallet";
import { apiUrl } from "./api";
import type { Proof } from "@cashu/cashu-ts";

export interface StoredProof {
  keyset_id: string;
  C: string;
  secret: string;
  amount: number;
}

export interface StoredProofBundle {
  proofs: StoredProof[];
  mint_url: string;
  amount: number;
}

export function signSecretHex(secret: string, skHex: string): string {
  const digest = sha256(new TextEncoder().encode(secret));
  return bytesToHex(schnorr.sign(digest, hexToBytes(skHex)));
}

export function buildWitness(
  proof: { id: string; amount: number; secret: string; C: string },
  signatures: string[],
): Proof {
  return {
    ...proof,
    witness: JSON.stringify({ signatures }),
  } as unknown as Proof;
}

export async function swapLockedProofs(
  proofs: Proof[],
  amount: number,
  privkeyHex: string,
): Promise<Proof[]> {
  const mintUrl = (proofs[0] as unknown as { mint_url?: string }).mint_url ?? "";
  if (!mintUrl) throw new Error("proof.mint_url is required");
  const wallet = buildWallet(mintUrl);
  await loadMintCached(wallet, mintUrl);
  const preview = await wallet.prepareSwapToSend(Amount.from(amount), proofs);
  const result = await wallet.completeSwap(preview, privkeyHex);
  return [...result.send, ...result.keep];
}

export async function fetchClaimData(
  auctionId: string,
  sellerPubkey: string,
  apiBase?: string,
): Promise<StoredProofBundle> {
  const res = await fetch(
    apiUrl(`/auctions/${auctionId}/claim-data?seller_pubkey=${sellerPubkey}`, apiBase),
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "claim-data failed");
  }
  return res.json() as Promise<StoredProofBundle>;
}

export async function fetchRefundData(
  bidId: string,
  bidderPubkey: string,
  apiBase?: string,
): Promise<StoredProofBundle> {
  const res = await fetch(apiUrl(`/bids/${bidId}/refund-data?bidder_pubkey=${bidderPubkey}`, apiBase));
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "refund-data failed");
  }
  return res.json() as Promise<StoredProofBundle>;
}

export async function requestCoSign(
  auctionId: string,
  secrets: string[],
  sellerSigs: string[],
  apiBase?: string,
): Promise<string[]> {
  const res = await fetch(apiUrl(`/auctions/${auctionId}/co-sign`, apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secrets, seller_sigs: sellerSigs }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "co-sign failed");
  }
  const data = (await res.json()) as { server_sigs: string[] };
  return data.server_sigs;
}

/** Full seller claim: fetch → sign all → server builds the fee-split swap and
 * returns either the seller's new proofs (legacy) or locks funds in escrow
 * for the simplified flow. */
export async function claimAuction(
  auctionId: string,
  sellerPubkey: string,
  sellerSkHex: string,
  apiBase?: string,
): Promise<{ proofs: Proof[]; fee: number; escrowed?: boolean; amount?: number; pendingRid?: number }> {
  const bundle = await fetchClaimData(auctionId, sellerPubkey, apiBase);

  const secrets = bundle.proofs.map((p) => p.secret);
  const sellerSigs = secrets.map((s) => signSecretHex(s, sellerSkHex));

  const res = await fetch(apiUrl(`/auctions/${auctionId}/claim`, apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secrets, seller_sigs: sellerSigs }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "claim failed");
  }
  const data = (await res.json()) as
    | { seller_proofs: Proof[]; fee: number; change?: number; pending_rid?: number }
    | { escrowed: true; amount: number; fee: number; change: number };
  if ("escrowed" in data && data.escrowed) {
    // Two-stage escrow: sellerNet is locked, not in wallet yet.
    // Change (if any) is still returned as winner change, but seller gets nothing yet.
    // No proofs to store for the seller at this stage.
    return { proofs: [], fee: data.fee, escrowed: true, amount: data.amount };
  }
  const legacy = data as { seller_proofs: Proof[]; fee: number; pending_rid?: number };
  if (Array.isArray(legacy.seller_proofs)) {
    storeProofsInWallet(legacy.seller_proofs, bundle.mint_url, sellerPubkey);
    return {
      proofs: legacy.seller_proofs,
      fee: legacy.fee,
      // Durable mirror row id — the caller acks it once the wallet stored
      // the proofs (until then Fund Collection can re-deliver).
      pendingRid: legacy.pending_rid,
    };
  }
  // Fallback for unexpected shape
  return { proofs: [], fee: 0 };
}

/** Full bidder refund: fetch → sign each with the refund key → swap. */
export async function refundBid(
  bidId: string,
  bidderPubkey: string,
  bidderSkHex: string,
  apiBase?: string,
): Promise<Proof[]> {
  const bundle = await fetchRefundData(bidId, bidderPubkey, apiBase);

  // 2-of-3 outbid refund: bidder signs each secret, server co-signs (no locktime wait).
  const secrets = bundle.proofs.map((sp) => sp.secret);
  const bidderSigs = secrets.map((s) => signSecretHex(s, bidderSkHex));
  const serverSigs = await requestRefundCoSign(bidId, secrets, bidderSigs, apiBase);

  const proofs: Proof[] = bundle.proofs.map((sp, i) =>
    buildWitness({ id: sp.keyset_id, amount: sp.amount, secret: sp.secret, C: sp.C }, [
      bidderSigs[i]!,
      serverSigs[i]!,
    ]),
  );
  for (const pr of proofs) {
    (pr as unknown as { mint_url: string }).mint_url = bundle.mint_url;
  }
  const recovered = await swapLockedProofs(proofs, bundle.amount, bidderSkHex);
  // Persist the recovered proofs into the wallet store — without this the
  // swapped-out sats never appear in the balance (and their secrets are lost).
  storeProofsInWallet(recovered, bundle.mint_url, bidderPubkey);
  // Notify the server so the bid is marked refunded (idempotency).
  fetch(apiUrl(`/bids/${bidId}/refunded?bidder_pubkey=${bidderPubkey}`, apiBase), {
    method: "POST",
  }).catch(() => {});
  return recovered;
}

async function requestRefundCoSign(
  bidId: string,
  secrets: string[],
  bidderSigs: string[],
  apiBase?: string,
): Promise<string[]> {
  const res = await fetch(apiUrl(`/bids/${bidId}/refund-co-sign`, apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secrets, bidder_sigs: bidderSigs }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "refund co-sign failed");
  }
  const data = (await res.json()) as { server_sigs: string[] };
  return data.server_sigs;
}

export interface ChangeReturn {
  proofs: StoredProof[];
  amount: number;
  mint_url: string;
}

export async function fetchChangeData(
  auctionId: string,
  bidderPubkey: string,
  apiBase?: string,
): Promise<ChangeReturn> {
  const res = await fetch(
    apiUrl(`/auctions/${auctionId}/change?bidder_pubkey=${bidderPubkey}`, apiBase),
    { cache: "no-store" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "change fetch failed");
  }
  return res.json() as Promise<ChangeReturn>;
}

/** The winner sweeps the excess (locked max − standing price) into their wallet.
 * The change proofs are 1-of-1 P2PK to the winner. They are swapped (with the
 * winner's key signing the witness) into ordinary spendable proofs before being
 * stored — storing raw P2PK proofs would make the balance over-count AND break
 * later withdrawals ("Witness signatures not provided"). */
export async function collectChange(
  auctionId: string,
  bidderPubkey: string,
  bidderSkHex: string,
  apiBase?: string,
): Promise<ChangeReturn> {
  const data = await fetchChangeData(auctionId, bidderPubkey, apiBase);
  if (data.proofs.length === 0) return data;
  // Only P2PK-locked proofs need a swap (witness signature). Ordinary proofs
  // are stored as-is.
  const locked = data.proofs.filter((sp) => isP2PKSecret(sp.secret));
  const plain = data.proofs.filter((sp) => !isP2PKSecret(sp.secret));
  if (locked.length === 0) {
    storeProofsInWallet(plain as unknown as Proof[], data.mint_url, bidderPubkey);
    return data;
  }
  // Attach the mint URL the same way swapLockedProofs expects.
  const proofs = locked.map((sp) => {
    const p = {
      id: sp.keyset_id,
      amount: sp.amount,
      secret: sp.secret,
      C: sp.C,
    } as unknown as Proof;
    (p as unknown as { mint_url: string }).mint_url = data.mint_url;
    return p;
  });
  const swapped = await swapLockedProofs(proofs, data.amount, bidderSkHex);
  storeProofsInWallet(
    [...swapped, ...(plain as unknown as Proof[])],
    data.mint_url,
    bidderPubkey,
  );
  return {
    proofs: [...swapped, ...plain] as unknown as StoredProof[],
    amount: data.amount,
    mint_url: data.mint_url,
  };
}

/** True when a proof secret is a NUT-11 P2PK lock (1-of-1 winner change,
 * 2-of-3 bid, etc.) — such proofs need a witness to spend. */
function isP2PKSecret(secret: string): boolean {
  try {
    const parsed = JSON.parse(secret) as unknown
    return Array.isArray(parsed) && parsed[0] === "P2PK"
  } catch {
    return false
  }
}
