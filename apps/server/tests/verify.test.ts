import { describe, it, expect, beforeEach } from "vite-plus/test"
import { initDb, type Db } from "../src/db/index.js"
import type { Auction } from "@cashu-auction/shared"

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "auction-1",
    item: "test item",
    description: "desc",
    start_price: 100,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    ...overrides,
  }
}

const SELLER_PUBKEY = "02deadbeef"
const BIDDER_PUBKEY = "03cafebabe"

function makeP2PKSecret(
  data: string,
  locktime: number,
  refund: string,
  nonce = "abc123",
): string {
  return JSON.stringify([
    "P2PK",
    {
      nonce,
      data,
      tags: [
        ["locktime", String(locktime)],
        ["refund", refund],
      ],
    },
  ])
}

import {
  parseP2PKSecret,
  computeY,
  verifyBid,
} from "../src/verify/index.js"

describe("parseP2PKSecret", () => {
  it("extracts data, locktime, and refund from a valid P2PK secret", () => {
    const locktime = Date.now() + 48 * 3600_000
    const secret = makeP2PKSecret(SELLER_PUBKEY, locktime, BIDDER_PUBKEY)

    const result = parseP2PKSecret(secret)
    expect(result).not.toHaveProperty("code")
    if ("data" in result) {
      expect(result.data).toBe(SELLER_PUBKEY)
      expect(result.locktime).toBe(locktime)
      expect(result.refund).toBe(BIDDER_PUBKEY)
    }
  })

  it("returns error for non-P2PK secret", () => {
    const secret = JSON.stringify(["HTLC", { nonce: "x", data: "y" }])
    const result = parseP2PKSecret(secret)
    expect(result).toHaveProperty("code", "NOT_P2PK_SECRET")
  })

  it("returns error for invalid JSON", () => {
    const result = parseP2PKSecret("not-json")
    // cashu-ts getSecretKind throws on invalid JSON
    expect(result).toHaveProperty("code")
  })

  it("handles multiple refund pubkeys", () => {
    const locktime = Date.now() + 48 * 3600_000
    const secret = makeP2PKSecret(
      SELLER_PUBKEY,
      locktime,
      `${BIDDER_PUBKEY},other_pubkey`,
    )
    const result = parseP2PKSecret(secret)
    if ("data" in result) {
      expect(result.refund).toBe(`${BIDDER_PUBKEY},other_pubkey`)
    } else {
      expect.unreachable()
    }
  })
})

describe("computeY", () => {
  it("produces a deterministic hex output for the same secret", () => {
    const locktime = Date.now() + 48 * 3600_000
    const secret = makeP2PKSecret(SELLER_PUBKEY, locktime, BIDDER_PUBKEY)

    const y1 = computeY(secret)
    const y2 = computeY(secret)
    expect(y1).toBe(y2)
    expect(y1).toMatch(/^[0-9a-f]{2,}$/)
  })

  it("produces different Y for different secrets", () => {
    const locktime = Date.now() + 48 * 3600_000
    const s1 = makeP2PKSecret(SELLER_PUBKEY, locktime, BIDDER_PUBKEY, "nonce1")
    const s2 = makeP2PKSecret(SELLER_PUBKEY, locktime, BIDDER_PUBKEY, "nonce2")

    expect(computeY(s1)).not.toBe(computeY(s2))
  })
})

describe("verifyBid", () => {
  let auction: Auction

  beforeEach(() => {
    auction = makeAuction({
      end_time: Date.now() + 3600_000,
      seller_pubkey: SELLER_PUBKEY,
    })
  })

  it("rejects if auction is not active", async () => {
    auction.state = "CLOSED"
    const result = await verifyBid(
      {
        proof: { id: "x", amount: 200, secret: "x", C: "x" },
        mint_url: "https://mint.example.com",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("AUCTION_NOT_ACTIVE")
  })

  it("rejects if amount is below start_price", async () => {
    const result = await verifyBid(
      {
        proof: { id: "x", amount: 50, secret: "x", C: "x" },
        mint_url: "https://mint.example.com",
        auction_id: "a1",
        amount: 50,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("BELOW_START_PRICE")
  })

  it("rejects if proof amount mismatches claimed amount", async () => {
    const result = await verifyBid(
      {
        proof: { id: "x", amount: 300, secret: "x", C: "x" },
        mint_url: "https://mint.example.com",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("AMOUNT_MISMATCH")
  })

  it("rejects if P2PK pubkey does not match seller", async () => {
    const locktime = auction.end_time + 48 * 3600_000
    const secret = makeP2PKSecret("wrong_pubkey", locktime, BIDDER_PUBKEY)
    const result = await verifyBid(
      {
        proof: { id: "x", amount: 200, secret, C: "x" },
        mint_url: "https://mint.example.com",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("PUBKEY_MISMATCH")
  })

  it("rejects if locktime is too early", async () => {
    const locktime = auction.end_time + 1000 // only 1 second margin
    const secret = makeP2PKSecret(SELLER_PUBKEY, locktime, BIDDER_PUBKEY)
    const result = await verifyBid(
      {
        proof: { id: "x", amount: 200, secret, C: "x" },
        mint_url: "https://mint.example.com",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("LOCKTIME_TOO_EARLY")
  })

  it("rejects if refund does not include bidder", async () => {
    const locktime = auction.end_time + 48 * 3600_000
    const secret = makeP2PKSecret(SELLER_PUBKEY, locktime, "someone_else")
    const result = await verifyBid(
      {
        proof: { id: "x", amount: 200, secret, C: "x" },
        mint_url: "https://mint.example.com",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("REFUND_MISMATCH")
  })
})
