import type { Auction, Bid } from "@cashu-auction/shared"
import { canonicalPubkey } from "./lib/canonical.js"
import { parseP2PKSecret } from "./verify/index.js"

export type ClaimResult =
  | { ok: true; winningSecret: string; locktimeSec: number }
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
  const proof = JSON.parse(winningBid.proof_data) as { secret: string }
  const parsed = parseP2PKSecret(proof.secret)
  if ("code" in parsed) return { ok: false, error: "INVALID_PROOF" }

  const locktimeSec = parsed.locktime
  if (Math.floor(Date.now() / 1000) >= locktimeSec) {
    return { ok: false, error: "CLAIM_EXPIRED" }
  }

  return { ok: true, winningSecret: proof.secret, locktimeSec }
}

export function parseProofData(proofData: string): {
  keyset_id: string
  C: string
  secret: string
  mint_url: string
  amount: number
} {
  return JSON.parse(proofData)
}
