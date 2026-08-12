import type { Bid } from "@cashu-auction/shared"
import type { Db } from "./db/index.js"
import type { Publisher } from "./nostr/publisher.js"
import { verifyBid, type BidPayload } from "./verify/index.js"
import { withAuctionLock } from "./lib/auction-lock.js"
import { computeStandingPrice } from "./lib/standing-price.js"
import { calcFee } from "./lib/auction-fee.js"

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

    const allBids = db.getAllBids(auction.id)
    const verifiedBids = allBids.filter((b) => b.status === "verified")
    const prevLeader = verifiedBids[0] ?? null
    const currentPrice = prevLeader ? prevLeader.current_amount : undefined

    const result = await verifyBid(payload, auction, currentPrice, serverPubkey)
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
    const newMax = payload.amount

    // ── Proxy bidding (second price) ────────────────────────────
    // Each bidder's effective max is the highest max across all their bids
    // (re-bids only ever raise it). The standing price = second-highest
    // effective max + min increment, capped at the highest, or the start
    // price while only one bidder is active.
    const maxByBidder = new Map<string, number>()
    for (const b of allBids) {
      const prev = maxByBidder.get(b.bidder_npub) ?? 0
      if (b.max_amount > prev) maxByBidder.set(b.bidder_npub, b.max_amount)
    }
    maxByBidder.set(
      payload.bidder_pubkey,
      Math.max(maxByBidder.get(payload.bidder_pubkey) ?? 0, newMax),
    )
    const newPrice = computeStandingPrice(auction.start_price, [...maxByBidder.values()])

    const newIsLeader = prevLeader === null || newMax > prevLeader.max_amount

    const bid: Bid = {
      id: `${payload.auction_id}-${result.Ys.map((y) => y.slice(0, 6)).join("-")}`,
      auction_id: payload.auction_id,
      max_amount: newMax,
      // Standing price for the leader; for an immediately-outbid bid this is
      // the price the auction moved to (NOT the max — max stays server-side).
      current_amount: newPrice,
      bidder_npub: payload.bidder_pubkey,
      Y,
      received_at: Date.now(),
      status: newIsLeader ? "verified" : "outbid",
      proof_data: proofData,
    }
    db.saveBid(bid)

    if (newIsLeader) {
      // Any previously-verified bid is now superseded → outbid (immediately
      // refundable by the bidder + server co-sign, §6.4). Its current_amount
      // stays frozen at the price it last stood at.
      for (const oldBid of verifiedBids) {
        if (oldBid.id !== bid.id && oldBid.status === "verified") {
          oldBid.status = "outbid"
          db.saveBid(oldBid)
        }
      }
    } else if (prevLeader) {
      // The standing leader keeps the lead, but the price rose under them.
      prevLeader.current_amount = newPrice
      db.saveBid(prevLeader)
    }

    pub.publishBid(
      auction.id,
      auction.seller_pubkey,
      payload.bidder_pubkey,
      bid.current_amount,
      Y,
      bid.received_at,
    )

    // ── Buy-now: a max reaching buy_now_price settles immediately at that price ──
    if (
      auction.buy_now_price !== null &&
      auction.buy_now_price > 0 &&
      newMax >= auction.buy_now_price
    ) {
      auction.state = "SETTLED"
      auction.winner_npub = bid.bidder_npub
      auction.winning_amount = auction.buy_now_price
      bid.current_amount = auction.buy_now_price
      db.saveBid(bid)
      db.saveAuction(auction)
      pub.publishSettlement(
        auction.id,
        auction.seller_pubkey,
        bid.bidder_npub,
        bid.current_amount,
        db.getVerifiedBids(auction.id).length,
        "sold",
        calcFee(bid.current_amount),
      )
      return { ok: true, buyNow: true }
    }

    return { ok: true }
  })
}
