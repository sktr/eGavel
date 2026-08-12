/**
 * Minimum bid increment table (Yahoo-auction style, per amount band).
 * Proxy bidding bids at: 2nd-highest max + minBidIncrement(2nd-highest max).
 */
const MIN_INCREMENT_TABLE: ReadonlyArray<readonly [minAmount: number, increment: number]> = [
  [1, 10],
  [1000, 100],
  [10000, 500],
  [100000, 1000],
  [1_000_000, 5000],
]

export function minBidIncrement(amount: number): number {
  let increment = 10
  for (const [minAmount, inc] of MIN_INCREMENT_TABLE) {
    if (amount >= minAmount) increment = inc
    else break
  }
  return increment
}
