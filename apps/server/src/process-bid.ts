import type { Bid } from "@egavel/shared"
import type { Db } from "./db/index.js"
import { verifyBid, type BidPayload } from "./verify/index.js"
import { withAuctionLock } from "./lib/auction-lock.js"
import { computeStandingPrice } from "./lib/standing-price.js"
import { ANTI_SNIPING_WINDOW, EXTEND_BY } from "./lib/settle.js"

export type ProcessBidResult =
  | { ok: true; buyNow?: boolean; current_amount?: number }
  | { ok: false; error: string }

export type ProcessPendingBidResult = { ok: true } | { ok: false; error: string }

/**
 * Pre-registers a locked proof bundle WITHOUT making it a bid.
 *
 * The bundle is fully verified (P2PK structure, server key, mint, NUT-07) but
 * saved with status='pending': it never becomes leader, never moves the
 * standing price, never outbids existing bids, and never triggers buy-now or
 * anti-sniping. The eventual live bid reuses the same deterministic id
 * (derived from the proofs' Ys) and simply overwrites this row via
 * `saveBid`'s INSERT OR REPLACE. No proof lock is taken here, so the live
 * bid's `tryLockProofs` is unaffected.
 *
 * Because the server stores the bundle, a pending bid can be refunded
 * immediately (bidder + server co-sign) if the live bid never lands.
 */
export async function processPendingBid(
  payload: BidPayload,
  db: Db,
  serverPubkey?: string,
): Promise<ProcessPendingBidResult> {
  const auction = await db.getAuction(payload.auction_id)
  if (!auction) return { ok: false, error: "auction not found" }

  const link = await db.getNostrLink(payload.bidder_pubkey)
  if (!link) return { ok: false, error: "LINK_REQUIRED" }

  const result = await verifyBid(payload, auction, undefined, serverPubkey)
  if (!result.ok) {
    const err = result.error
    return {
      ok: false,
      error: `verify error: ${"code" in err ? err.code : JSON.stringify(err)}`,
    }
  }

  const Y = result.Ys.join(",")
  const bidId = `${payload.auction_id}-${result.Ys.map((y) => y.slice(0, 6)).join("-")}`

  // Downgrade guard: if this bundle already backs a LIVE bid (same
  // deterministic id — e.g. a retry of the pre-register step after the live
  // bid landed, or two tabs), do NOT overwrite it with a pending row. The
  // live bid stays live; the client's own reconcile will see it as such.
  // This is enforced atomically in SQL (`savePendingBid`'s upsert only writes
  // when the existing row is NOT `verified`), so a concurrent live bid can
  // never be demoted by a stray pending save — the in-process withAuctionLock
  // does not span Worker isolates.
  const bid: Bid = {
    id: bidId,
    auction_id: payload.auction_id,
    max_amount: payload.amount,
    current_amount: 0, // cosmetic; never exposed via getVerifiedBids
    bidder_npub: payload.bidder_pubkey,
    Y,
    received_at: Date.now(),
    status: "pending",
    proof_data: JSON.stringify({
      proofs: payload.proofs.map((p) => ({
        keyset_id: p.id,
        C: p.C,
        secret: p.secret,
        amount: p.amount,
      })),
      mint_url: payload.mint_url,
      amount: payload.amount,
    }),
  }
  await db.savePendingBid(bid)
  return { ok: true }
}

export async function processBid(
  payload: BidPayload,
  db: Db,
  serverPubkey?: string,
): Promise<ProcessBidResult> {
  return withAuctionLock(payload.auction_id, async () => {
    const auction = await db.getAuction(payload.auction_id)
    if (!auction) return { ok: false, error: "auction not found" }

    const link = await db.getNostrLink(payload.bidder_pubkey)
    if (!link) return { ok: false, error: "LINK_REQUIRED" }

    const allBids = await db.getAllBids(auction.id)
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

    const Y = result.Ys.join(",")
    const bidId = `${payload.auction_id}-${result.Ys.map((y) => y.slice(0, 6)).join("-")}`
    const newMax = payload.amount

    // ── Proof double-lock guard ─────────────────────────────
    // The same proofs (same Ys) must not back more than one bid: a bundle
    // locked on two auctions would be claimable/refundable only once, silently
    // breaking the other auction's settlement. Lock BEFORE saving the bid, and
    // roll back our own acquisitions if the bundle is already locked elsewhere.
    const acquired = await db.tryLockProofs(bidId, auction.id, result.Ys)
    if (acquired.length !== result.Ys.length) {
      await db.unlockProofs(bidId, acquired)
      return { ok: false, error: "verify error: PROOF_ALREADY_LOCKED" }
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

    // ── Proxy bidding (second price) ────────────────────────────
    // Each bidder's effective max is the highest max across all their bids
    // (re-bids only ever raise it). The standing price = second-highest
    // effective max + min increment, capped at the highest, or the start
    // price while only one bidder is active.
    const maxByBidder = new Map<string, number>()
    for (const b of allBids) {
      if (b.status === "pending") continue // pre-registrations never price
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
      id: bidId,
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
    await db.saveBid(bid)

    if (newIsLeader) {
      // Any previously-verified bid is now superseded → outbid (immediately
      // refundable by the bidder + server co-sign, §6.4). Its current_amount
      // stays frozen at the price it last stood at.
      for (const oldBid of verifiedBids) {
        if (oldBid.id !== bid.id && oldBid.status === "verified") {
          oldBid.status = "outbid"
          await db.saveBid(oldBid)
        }
      }
    } else if (prevLeader) {
      // The standing leader keeps the lead, but the price rose under them.
      prevLeader.current_amount = newPrice
      await db.saveBid(prevLeader)
    }

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
      await db.saveBid(bid)
      await db.saveAuction(auction)
      return { ok: true, buyNow: true, current_amount: auction.buy_now_price }
    }

    // ── Anti-sniping (event-driven): a bid in the last 5 minutes of the
    // current end time extends the auction by 5 minutes ──
    if (
      bid.received_at > auction.end_time - ANTI_SNIPING_WINDOW &&
      bid.received_at <= auction.end_time
    ) {
      auction.state = "EXTENDED"
      auction.end_time = auction.end_time + EXTEND_BY
      auction.last_extended_at = Date.now()
      await db.saveAuction(auction)
    }

    return { ok: true, current_amount: newPrice }
  })
}
