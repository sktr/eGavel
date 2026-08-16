/**
 * Seller-paid auction fee (AUCTION_FEE_BPS, default 0).
 *
 * The public instance runs as a free marketplace — the operator takes no
 * fee. The mechanism stays (same value at settle time and in the actual
 * claim split) so a future operator can set AUCTION_FEE_BPS to charge one.
 */
export function auctionFeeBps(): number {
  return Number(process.env.AUCTION_FEE_BPS ?? 0)
}

export function calcFee(winningAmount: number): number {
  return Math.floor((winningAmount * auctionFeeBps()) / 10000)
}
