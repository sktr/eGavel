import type { PendingBidEntry } from "./pending-bids";

/** An auction lookup entry narrowed to what auto-recovery needs. */
export interface LocktimeExpiredAuction {
  state: string;
  winner_npub: string | null;
  /** True once the seller has claimed the winning bid (funds already moved). */
  claimed?: boolean;
}

/** Entries whose P2PK locktime has passed and whose bid is a winner's bid
 * (verified) on a settled auction the seller has not claimed. */
export function locktimeExpiredWinningEntries(
  entries: PendingBidEntry[],
  auctions: Record<string, LocktimeExpiredAuction>,
  myPubkey: string,
  now = Date.now(),
): PendingBidEntry[] {
  return entries.filter((e) => {
    if (e.status !== "live") return false;
    if (e.locktime * 1000 > now) return false;
    const a = auctions[e.auctionId];
    if (!a || a.state !== "SETTLED" || a.claimed) return false;
    // Recoverable shapes:
    //  - I am the winner and the seller never claimed (classic path);
    //  - the auction settled with NO winner (reserve unmet) — every bidder's
    //    own locked proofs are otherwise frozen forever, since refund-data
    //    rejects verified bids. The local copy + refund key suffice.
    return a.winner_npub === myPubkey || a.winner_npub === null;
  });
}
