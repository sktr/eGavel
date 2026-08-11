import type { Bid } from "@cashu-auction/shared"
import type { Db } from "./db/index.js"
import type { Publisher } from "./nostr/publisher.js"
import { verifyBid, type BidPayload } from "./verify/index.js"
import { withAuctionLock } from "./lib/auction-lock.js"

export type ProcessBidResult =
  | { ok: true; buyNow?: boolean }
  | { ok: false; error: string }

export async function processBid(
  payload: BidPayload,
  db: Db,
  pub: Publisher,
  serverPubkey?: string,
): Promise<ProcessBidResult> {
  return withAuctionLock(payload.auction_id, async () => {
    const auction = db.getAuction(payload.auction_id)
    if (!auction) return { ok: false, error: "auction not found" }

    const existingBids = db.getVerifiedBids(auction.id)
    const highestBid = existingBids.length > 0 ? existingBids[0]!.amount : undefined

    const result = await verifyBid(payload, auction, highestBid, serverPubkey)
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
      amount: payload.amount,
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

    // ── Buy-now: amount >= buy_now_price settles immediately ──
    if (
      auction.buy_now_price !== null &&
      auction.buy_now_price > 0 &&
      payload.amount >= auction.buy_now_price
    ) {
      auction.state = "SETTLED"
      auction.winner_npub = bid.bidder_npub
      auction.winning_amount = bid.amount
      db.saveAuction(auction)
      pub.publishSettlement(
        auction.id,
        auction.seller_pubkey,
        bid.bidder_npub,
        bid.amount,
        db.getVerifiedBids(auction.id).length,
      )
      return { ok: true, buyNow: true }
    }

    return { ok: true }
  })
}
