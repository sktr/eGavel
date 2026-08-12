import { minBidIncrement } from "./min-increment.js"

/**
 * Computes the standing price (second price) from a set of max_amounts.
 *
 * Rules:
 * - Single bidder: price = start price
 * - Two or more: price = min(highest max, 2nd-highest max + minBidIncrement(2nd max))
 * - The price never goes below the start price
 *
 * The winner is the bidder with the highest max. Ties go to the earlier bidder.
 */
export function computeStandingPrice(startPrice: number, maxes: number[]): number {
  if (maxes.length === 0) return startPrice
  const sorted = [...maxes].sort((a, b) => b - a)
  const highest = sorted[0]!
  const second = sorted[1]
  if (second === undefined) {
    return Math.max(startPrice, 0)
  }
  const price = Math.min(highest, second + minBidIncrement(second))
  return Math.max(startPrice, price)
}
