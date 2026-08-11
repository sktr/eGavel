import { schnorr } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, hexToBytes } from "nostr-tools/utils"
import { Wallet, Amount } from "@cashu/cashu-ts"
import type { Proof } from "@cashu/cashu-ts"

export interface StoredProof {
  keyset_id: string
  C: string
  secret: string
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

export async function swapLockedProof(
  proof: Proof,
  amount: number,
  privkeyHex: string,
): Promise<Proof[]> {
  const mintUrl = (proof as unknown as { mint_url?: string }).mint_url ?? ""
  const wallet = new Wallet(mintUrl, { unit: "sat" })
  await wallet.loadMint()
  const preview = await wallet.prepareSwapToSend(Amount.from(amount), [proof])
  const result = await wallet.completeSwap(preview, privkeyHex)
  return [...result.send, ...result.keep]
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

export async function fetchClaimData(
  auctionId: string,
  sellerPubkey: string,
  apiBase = API_BASE,
): Promise<StoredProof> {
  const res = await fetch(
    `${apiBase}/api/auctions/${auctionId}/claim-data?seller_pubkey=${sellerPubkey}`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "claim-data failed")
  }
  return res.json() as Promise<StoredProof>
}

export async function fetchRefundData(
  bidId: string,
  bidderPubkey: string,
  apiBase = API_BASE,
): Promise<StoredProof> {
  const res = await fetch(
    `${apiBase}/api/bids/${bidId}/refund-data?bidder_pubkey=${bidderPubkey}`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "refund-data failed")
  }
  return res.json() as Promise<StoredProof>
}

export async function requestCoSign(
  auctionId: string,
  secret: string,
  sellerSig: string,
  apiBase = API_BASE,
): Promise<string> {
  const res = await fetch(`${apiBase}/api/auctions/${auctionId}/co-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, seller_sig: sellerSig }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "co-sign failed")
  }
  const data = (await res.json()) as { server_sig: string }
  return data.server_sig
}

/** Full seller claim: fetch → sign → co-sign → swap. Returns new wallet proofs. */
export async function claimAuction(
  auctionId: string,
  sellerPubkey: string,
  sellerSkHex: string,
  apiBase = API_BASE,
): Promise<Proof[]> {
  const sp = await fetchClaimData(auctionId, sellerPubkey, apiBase)
  const sellerSig = signSecretHex(sp.secret, sellerSkHex)
  const serverSig = await requestCoSign(auctionId, sp.secret, sellerSig, apiBase)
  const proof = buildWitness(
    { id: sp.keyset_id, amount: sp.amount, secret: sp.secret, C: sp.C },
    [sellerSig, serverSig],
  )
  ;(proof as unknown as { mint_url: string }).mint_url = sp.mint_url
  return swapLockedProof(proof, sp.amount, sellerSkHex)
}

/** Full bidder refund: fetch → sign (refund key) → swap. */
export async function refundBid(
  bidId: string,
  bidderPubkey: string,
  bidderSkHex: string,
  apiBase = API_BASE,
): Promise<Proof[]> {
  const sp = await fetchRefundData(bidId, bidderPubkey, apiBase)
  const bidderSig = signSecretHex(sp.secret, bidderSkHex)
  const proof = buildWitness(
    { id: sp.keyset_id, amount: sp.amount, secret: sp.secret, C: sp.C },
    [bidderSig],
  )
  ;(proof as unknown as { mint_url: string }).mint_url = sp.mint_url
  return swapLockedProof(proof, sp.amount, bidderSkHex)
}
