import type { Bid } from "@cashu-auction/shared"
import type { Db } from "./db/index.js"
import type { Publisher } from "./nostr/publisher.js"
import { verifyBid, type BidPayload } from "./verify/index.js"

export async function processBid(
  payload: BidPayload,
  db: Db,
  pub: Publisher,
): Promise<{ ok: boolean; error?: string }> {
  const auction = db.getAuction(payload.auction_id)
  if (!auction) return { ok: false, error: "auction not found" }

  const existingBids = db.getVerifiedBids(auction.id)
  const highestBid = existingBids.length > 0 ? existingBids[0]!.amount : undefined

  const result = await verifyBid(payload, auction, highestBid)
  if (!result.ok) {
    const err = result.error
    return {
      ok: false,
      error: `verify error: ${"code" in err ? err.code : JSON.stringify(err)}`,
    }
  }

  const proofData = JSON.stringify({
    keyset_id: payload.proof.id,
    C: payload.proof.C,
    secret: payload.proof.secret,
    mint_url: payload.mint_url,
  })

  const bid: Bid = {
    id: `${payload.auction_id}-${result.Y}`,
    auction_id: payload.auction_id,
    amount: payload.amount,
    bidder_npub: payload.bidder_pubkey,
    Y: result.Y,
    received_at: Date.now(),
    status: "verified",
    proof_data: proofData,
  }
  db.saveBid(bid)

  pub.publishBid(
    auction.id,
    auction.seller_pubkey,
    payload.bidder_pubkey,
    payload.amount,
    result.Y,
    bid.received_at,
  )

  // Mark old bids from same bidder as replaced
  for (const oldBid of existingBids) {
    if (oldBid.bidder_npub === payload.bidder_pubkey && oldBid.id !== bid.id) {
      oldBid.status = "replaced"
      db.saveBid(oldBid)
    }
  }

  return { ok: true }
}
