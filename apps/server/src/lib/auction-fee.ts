/**
 * Seller-paid auction fee (AUCTION_FEE_BPS, default 5%).
 * Same value at settle time and in the actual claim split.
 */
export function auctionFeeBps(): number {
  return Number(process.env.AUCTION_FEE_BPS ?? 500)
}

export function calcFee(winningAmount: number): number {
  return Math.floor((winningAmount * auctionFeeBps()) / 10000)
}
