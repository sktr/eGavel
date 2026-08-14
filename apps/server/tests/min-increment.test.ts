import { describe, it, expect } from "vitest"
import { minBidIncrement } from "../src/lib/min-increment.js"

describe("minBidIncrement", () => {
  it("uses 10 sats below 1000 (Yahoo-style band 1)", () => {
    expect(minBidIncrement(1)).toBe(10)
    expect(minBidIncrement(500)).toBe(10)
    expect(minBidIncrement(999)).toBe(10)
  })

  it("uses 100 sats for 1000..9999", () => {
    expect(minBidIncrement(1000)).toBe(100)
    expect(minBidIncrement(5000)).toBe(100)
    expect(minBidIncrement(9999)).toBe(100)
  })

  it("uses 500 sats for 10000..99999", () => {
    expect(minBidIncrement(10000)).toBe(500)
    expect(minBidIncrement(50000)).toBe(500)
  })

  it("uses 1000 sats for 100000..999999", () => {
    expect(minBidIncrement(100000)).toBe(1000)
  })

  it("uses 5000 sats at 1M and above", () => {
    expect(minBidIncrement(1_000_000)).toBe(5000)
    expect(minBidIncrement(10_000_000)).toBe(5000)
  })
})
