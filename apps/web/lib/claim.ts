import { schnorr } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, hexToBytes } from "nostr-tools/utils"
import { Wallet, Amount } from "@cashu/cashu-ts"
import { storeProofsInWallet } from "./wallet"
import type { Proof } from "@cashu/cashu-ts"

export interface StoredProof {
  keyset_id: string
  C: string
  secret: string
  amount: number
}

export interface StoredProofBundle {
  proofs: StoredProof[]
  mint_url: string
  amount: number
}

export function signSecretHex(secret: string, skHex: string): string {
  const digest = sha256(new TextEncoder().encode(secret))
  return bytesToHex(schnorr.sign(digest, hexToBytes(skHex)))
}

export function buildWitness(
  proof: { id: string; amount: number; secret: string; C: string },
  signatures: string[],
): Proof {
  return {
    ...proof,
    witness: JSON.stringify({ signatures }),
  } as unknown as Proof
}

export async function swapLockedProofs(
  proofs: Proof[],
  amount: number,
  privkeyHex: string,
): Promise<Proof[]> {
  const mintUrl = (proofs[0] as unknown as { mint_url?: string }).mint_url ?? ""
  if (!mintUrl) throw new Error("proof.mint_url is required")
  const wallet = new Wallet(mintUrl, { unit: "sat" })
  await wallet.loadMint()
  const preview = await wallet.prepareSwapToSend(Amount.from(amount), proofs)
  const result = await wallet.completeSwap(preview, privkeyHex)
  return [...result.send, ...result.keep]
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "")

export async function fetchClaimData(
  auctionId: string,
  sellerPubkey: string,
  apiBase = API_BASE,
): Promise<StoredProofBundle> {
  const res = await fetch(
    `${apiBase}/api/auctions/${auctionId}/claim-data?seller_pubkey=${sellerPubkey}`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "claim-data failed")
  }
  return res.json() as Promise<StoredProofBundle>
}

export async function fetchRefundData(
  bidId: string,
  bidderPubkey: string,
  apiBase = API_BASE,
): Promise<StoredProofBundle> {
  const res = await fetch(
    `${apiBase}/api/bids/${bidId}/refund-data?bidder_pubkey=${bidderPubkey}`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "refund-data failed")
  }
  return res.json() as Promise<StoredProofBundle>
}

export async function requestCoSign(
  auctionId: string,
  secrets: string[],
  sellerSigs: string[],
  apiBase = API_BASE,
): Promise<string[]> {
  const res = await fetch(`${apiBase}/api/auctions/${auctionId}/co-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secrets, seller_sigs: sellerSigs }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "co-sign failed")
  }
  const data = (await res.json()) as { server_sigs: string[] }
  return data.server_sigs
}

/** Full seller claim: fetch → sign all → server builds the fee-split swap and
 * returns the seller's new proofs (spec §13.1). */
export async function claimAuction(
  auctionId: string,
  sellerPubkey: string,
  sellerSkHex: string,
  apiBase = API_BASE,
): Promise<{ proofs: Proof[]; fee: number }> {
  const bundle = await fetchClaimData(auctionId, sellerPubkey, apiBase)

  const secrets = bundle.proofs.map((p) => p.secret)
  const sellerSigs = secrets.map((s) => signSecretHex(s, sellerSkHex))

  const res = await fetch(`${apiBase}/api/auctions/${auctionId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secrets, seller_sigs: sellerSigs }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "claim failed")
  }
  const data = (await res.json()) as { seller_proofs: Proof[]; fee: number }
  storeProofsInWallet(data.seller_proofs, bundle.mint_url)
  return { proofs: data.seller_proofs, fee: data.fee }
}

/** Full bidder refund: fetch → sign each with the refund key → swap. */
export async function refundBid(
  bidId: string,
  bidderPubkey: string,
  bidderSkHex: string,
  apiBase = API_BASE,
): Promise<Proof[]> {
  const bundle = await fetchRefundData(bidId, bidderPubkey, apiBase)

  // 2-of-3 outbid refund: bidder signs each secret, server co-signs (no locktime wait).
  const secrets = bundle.proofs.map((sp) => sp.secret)
  const bidderSigs = secrets.map((s) => signSecretHex(s, bidderSkHex))
  const serverSigs = await requestRefundCoSign(bidId, secrets, bidderSigs, apiBase)

  const proofs: Proof[] = bundle.proofs.map((sp, i) =>
    buildWitness(
      { id: sp.keyset_id, amount: sp.amount, secret: sp.secret, C: sp.C },
      [bidderSigs[i]!, serverSigs[i]!],
    ),
  )
  for (const pr of proofs) {
    ;(pr as unknown as { mint_url: string }).mint_url = bundle.mint_url
  }
  const recovered = await swapLockedProofs(proofs, bundle.amount, bidderSkHex)
  // Persist the recovered proofs into the wallet store — without this the
  // swapped-out sats never appear in the balance (and their secrets are lost).
  storeProofsInWallet(recovered, bundle.mint_url)
  // Notify the server so the bid is marked refunded (idempotency).
  fetch(`${apiBase}/api/bids/${bidId}/refunded?bidder_pubkey=${bidderPubkey}`, {
    method: "POST",
  }).catch(() => {})
  return recovered
}

async function requestRefundCoSign(
  bidId: string,
  secrets: string[],
  bidderSigs: string[],
  apiBase = API_BASE,
): Promise<string[]> {
  const res = await fetch(`${apiBase}/api/bids/${bidId}/refund-co-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secrets, bidder_sigs: bidderSigs }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "refund co-sign failed")
  }
  const data = (await res.json()) as { server_sigs: string[] }
  return data.server_sigs
}

export interface ChangeReturn {
  proofs: StoredProof[]
  amount: number
  mint_url: string
}

export async function fetchChangeData(
  auctionId: string,
  bidderPubkey: string,
  apiBase = API_BASE,
): Promise<ChangeReturn> {
  const res = await fetch(
    `${apiBase}/api/auctions/${auctionId}/change?bidder_pubkey=${bidderPubkey}`,
    { cache: "no-store" },
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "change fetch failed")
  }
  return res.json() as Promise<ChangeReturn>
}

/** The winner sweeps the excess (locked max − standing price) into their wallet.
 * The change proofs are 1-of-1 P2PK to the winner, so no server interaction is
 * needed to spend them — storing them in the wallet is enough (same as the
 * seller's claim proofs). */
export async function collectChange(
  auctionId: string,
  bidderPubkey: string,
  apiBase = API_BASE,
): Promise<ChangeReturn> {
  const data = await fetchChangeData(auctionId, bidderPubkey, apiBase)
  storeProofsInWallet(data.proofs as unknown as Proof[], data.mint_url)
  return data
}
