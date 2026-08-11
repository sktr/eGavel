import { describe, it, expect } from "vite-plus/test"
import { canonicalPubkey } from "../src/lib/canonical.js"

describe("canonicalPubkey", () => {
  it("normalizes a 02-prefixed 66-char pubkey to its x-only form", () => {
    const x = "ab".repeat(32)
    expect(canonicalPubkey(`02${x}`)).toBe(x)
  })

  it("normalizes a 03-prefixed uppercase pubkey to lowercase x-only", () => {
    const x = "ab".repeat(32)
    expect(canonicalPubkey(`03${x.toUpperCase()}`)).toBe(x)
  })

  it("leaves an x-only 64-char pubkey unchanged", () => {
    const x = "ab".repeat(32)
    expect(canonicalPubkey(x)).toBe(x)
  })

  it("leaves short test keys unchanged (used by test fixtures)", () => {
    expect(canonicalPubkey("02deadbeef")).toBe("02deadbeef")
  })
})
