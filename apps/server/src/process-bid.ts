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
      proofs: payload.proofs.map((p) => ({
        keyset_id: p.id,
        C: p.C,
        secret: p.secret,
        amount: p.amount,
      })),
      mint_url: payload.mint_url,
      amount: payload.amount,
    })

    const Y = result.Ys.join(",")
    const bid: Bid = {
      id: `${payload.auction_id}-${result.Ys.map((y) => y.slice(0, 6)).join("-")}`,
      auction_id: payload.auction_id,
      amount: payload.amount,
      bidder_npub: payload.bidder_pubkey,
      Y,
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
      Y,
      bid.received_at,
    )

    // Any previously-verified bid is now superseded by this bid → outbid
    // (immediately refundable by the bidder + server co-sign, §6.4).
    for (const oldBid of existingBids) {
      if (oldBid.id !== bid.id && oldBid.status === "verified") {
        oldBid.status = "outbid"
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
