import { describe, it, expect } from "vite-plus/test"
import { computeStandingPrice } from "../src/lib/standing-price.js"

describe("computeStandingPrice", () => {
  it("a single bidder stands at the start price", () => {
    expect(computeStandingPrice(100, [1000])).toBe(100)
  })

  it("price = second-highest max + increment", () => {
    // 2000 vs 1500 → inc(1500)=100 → 1600
    expect(computeStandingPrice(100, [2000, 1500])).toBe(1600)
  })

  it("caps the price at the highest max when second + inc exceeds it", () => {
    // 1000 vs 995 → 995+10=1005 → cap at 1000
    expect(computeStandingPrice(100, [1000, 995])).toBe(1000)
  })

  it("a new higher max becomes the leader and pays second + inc", () => {
    // 3000 vs 2000 → min(3000, 2000+100)=2100
    expect(computeStandingPrice(100, [3000, 2000])).toBe(2100)
  })

  it("never returns below the start price", () => {
    expect(computeStandingPrice(500, [0, 0])).toBe(500)
    expect(computeStandingPrice(500, [0])).toBe(500)
  })

  it("applies the increment band of the second-highest amount", () => {
    expect(computeStandingPrice(100, [5000, 999])).toBe(1009)  // band: 10
    expect(computeStandingPrice(100, [5000, 1000])).toBe(1100) // band: 100
  })

  it("equal maxes: the price is the shared max (earlier bidder wins)", () => {
    expect(computeStandingPrice(100, [1000, 1000])).toBe(1000)
  })

  it("more than two bidders: only highest and second-highest matter", () => {
    expect(computeStandingPrice(100, [5000, 3000, 1000, 900])).toBe(3100)
  })
})
