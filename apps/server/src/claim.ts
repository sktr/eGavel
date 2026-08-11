import type { Auction, Bid } from "@cashu-auction/shared"
import { canonicalPubkey } from "./lib/canonical.js"
import { parseP2PKSecret } from "./verify/index.js"

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

export type ClaimResult =
  | { ok: true; winningSecrets: string[]; locktimeSec: number }
  | { ok: false; error: string }

export function validateClaim(
  auction: Auction,
  winningBid: Bid,
  claimantPubkey: string,
): ClaimResult {
  if (auction.state !== "SETTLED") return { ok: false, error: "NOT_SETTLED" }
  if (!auction.winner_npub) return { ok: false, error: "NO_WINNER" }
  if (canonicalPubkey(claimantPubkey) !== canonicalPubkey(auction.seller_pubkey)) {
    return { ok: false, error: "NOT_SELLER" }
  }

  if (!winningBid.proof_data) return { ok: false, error: "NO_PROOF" }
  let bundle: StoredProofBundle
  try {
    bundle = parseProofData(winningBid.proof_data)
  } catch {
    return { ok: false, error: "INVALID_PROOF" }
  }
  if (!Array.isArray(bundle.proofs) || bundle.proofs.length === 0) {
    return { ok: false, error: "INVALID_PROOF" }
  }

  // All proofs in a bid bundle share the same P2PK tags (one send), so the
  // locktime is the same across them.
  const parsed = parseP2PKSecret(bundle.proofs[0]!.secret)
  if ("code" in parsed) return { ok: false, error: "INVALID_PROOF" }

  const locktimeSec = parsed.locktime
  if (Math.floor(Date.now() / 1000) >= locktimeSec) {
    return { ok: false, error: "CLAIM_EXPIRED" }
  }

  return {
    ok: true,
    winningSecrets: bundle.proofs.map((p) => p.secret),
    locktimeSec,
  }
}

export function parseProofData(proofData: string): StoredProofBundle {
  try {
    return JSON.parse(proofData) as StoredProofBundle
  } catch {
    throw new Error("INVALID_PROOF")
  }
}
