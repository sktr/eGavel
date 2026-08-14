import { describe, it, expect, beforeEach, afterAll, vi, afterEach } from "vitest"
import { initDb, type Db } from "../src/db/index.js"
import type { Auction } from "@egavel/shared"
import { canonicalPubkey } from "../src/lib/canonical.js"

beforeEach(() => {
  process.env.ALLOW_TEST_BIDS = "1"
})

afterAll(() => {
  delete process.env.ALLOW_TEST_BIDS
})

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "auction-1",
    item: "test item",
    description: "desc",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  }
}

const SELLER_PUBKEY = "02deadbeef"
const BIDDER_PUBKEY = "03cafebabe"
const SERVER_PUBKEY = "04deadbeef"

function makeP2PKSecret(
  data: string,
  locktime: number,
  refund: string,
  nonce = "abc123",
  extra: string[][] = [],
): string {
  return JSON.stringify([
    "P2PK",
    {
      nonce,
      data,
      tags: [
        ["pubkeys", SERVER_PUBKEY, refund],
        ["n_sigs", "2"],
        ["locktime", String(locktime)],
        ["refund", refund],
        ...extra,
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
        proofs: [{ id: "x", amount: 200, secret: "x", C: "x" }],
        mint_url: "https://mint.example",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("AUCTION_NOT_ACTIVE")
  })

  it("rejects if amount is below start_price", async () => {
    const result = await verifyBid(
      {
        proofs: [{ id: "x", amount: 50, secret: "x", C: "x" }],
        mint_url: "https://mint.example",
        auction_id: "a1",
        amount: 50,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("BELOW_START_PRICE")
  })

  it("rejects a max at or below the current price (proxy bidding)", async () => {
    // payload.amount is the bidder's MAX; currentHighestBid is the current
    // standing price. A max <= current price can never take the lead.
    const result = await verifyBid(
      {
        proofs: [{ id: "x", amount: 300, secret: "x", C: "x" }],
        mint_url: "https://mint.example",
        auction_id: "a1",
        amount: 300,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
      300,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("BELOW_HIGHEST_BID")
  })

  it("accepts a max strictly above the current price", async () => {
    const locktime = auction.end_time + 48 * 3600_000
    const secret = makeP2PKSecret(SELLER_PUBKEY, locktime, BIDDER_PUBKEY)
    const result = await verifyBid(
      {
        proofs: [{ id: "x", amount: 400, secret, C: "x" }],
        mint_url: "test://local",
        auction_id: "a1",
        amount: 400,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
      300,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects if the locked proof value is below the claimed amount", async () => {
    const result = await verifyBid(
      {
        proofs: [{ id: "x", amount: 100, secret: "x", C: "x" }],
        mint_url: "https://mint.example",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("AMOUNT_MISMATCH")
  })

  it("rejects if P2PK pubkey does not match seller", async () => {
    const locktime = auction.end_time + 48 * 3600_000
    const secret = makeP2PKSecret("wrong_pubkey", locktime, BIDDER_PUBKEY)
    const result = await verifyBid(
      {
        proofs: [{ id: "x", amount: 200, secret, C: "x" }],
        mint_url: "https://mint.example",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("PUBKEY_MISMATCH")
  })

  it("rejects if locktime is too early", async () => {
    const locktime = Math.floor(auction.end_time / 1000) + 1 // only 1 second margin (seconds)
    const secret = makeP2PKSecret(SELLER_PUBKEY, locktime, BIDDER_PUBKEY)
    const result = await verifyBid(
      {
        proofs: [{ id: "x", amount: 200, secret, C: "x" }],
        mint_url: "https://mint.example",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("LOCKTIME_TOO_EARLY")
  })

  it("rejects if refund does not include bidder", async () => {
    const locktime = auction.end_time + 48 * 3600_000
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n-refund",
        data: SELLER_PUBKEY,
        tags: [
          ["pubkeys", SERVER_PUBKEY, BIDDER_PUBKEY],
          ["n_sigs", "2"],
          ["locktime", String(locktime)],
          ["refund", "someone_else"],
        ],
      },
    ])
    const result = await verifyBid(
      {
        proofs: [{ id: "x", amount: 200, secret, C: "x" }],
        mint_url: "https://mint.example",
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: BIDDER_PUBKEY,
      },
      auction,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("REFUND_MISMATCH")
  })
})

describe("canonicalPubkey", () => {
  it("normalizes 02-prefixed and x-only keys to the same value", () => {
    const x = "ab".repeat(32)
    expect(canonicalPubkey(`02${x}`)).toBe(x)
    expect(canonicalPubkey(x)).toBe(x)
    expect(canonicalPubkey(`03${x.toUpperCase()}`)).toBe(x)
  })
})

describe("parseP2PKSecret (standard lock)", () => {
  it("extracts pubkeys, nSigs and sigflag", () => {
    const locktime = Math.floor(Date.now() / 1000) + 48 * 3600
    const secret = makeP2PKSecret("02seller", locktime, "03bidder", "n1")
    const r = parseP2PKSecret(secret) as { pubkeys: string[]; nSigs: number; sigflag: string | null }
    expect(r.pubkeys).toContain(SERVER_PUBKEY)
    expect(r.nSigs).toBe(2)
    expect(r.sigflag).toBeNull()
  })

  it("rejects SIG_ALL sigflag", () => {
    const locktime = Math.floor(Date.now() / 1000) + 48 * 3600
    const secret = makeP2PKSecret("02seller", locktime, "03bidder", "n2", [["sigflag", "SIG_ALL"]])
    const r = parseP2PKSecret(secret)
    expect(r).toHaveProperty("code", "SIGFLAG_NOT_INPUTS")
  })
})

describe("verifyBid lock structure checks", () => {
  const auction = {
    id: "auction-1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "ACTIVE" as const,
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
  }
  const locktime = Math.floor((auction.end_time + 24 * 3600_000) / 1000) + 100

  function bidPayload(secret: string, overrides: Record<string, unknown> = {}) {
    return {
      proofs: [{ id: "keyset1", amount: 200, secret, C: "c" }],
      mint_url: "https://mint.example",
      auction_id: "auction-1",
      amount: 200,
      bidder_pubkey: "03cafebabe",
      ...overrides,
    }
  }

  it("rejects when pubkeys lacks the server key", async () => {
    // NOTE: build the secret from scratch — the `makeP2PKSecret` helper always emits
    // the correct `pubkeys` tag first, and cashu-ts `getTag` returns the FIRST match,
    // so appending an extra `["pubkeys", ...]` tag would NOT override it.
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n3",
        data: "02deadbeef",
        tags: [
          ["n_sigs", "2"],
          ["locktime", String(locktime)],
          ["refund", "03cafebabe"],
          ["pubkeys", "04other"], // server key absent
        ],
      },
    ])
    const result = await verifyBid(bidPayload(secret), auction as never, undefined, SERVER_PUBKEY)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("SERVER_KEY_MISMATCH")
  })

  it("accepts a bid where the bidder is also the seller (data key, deduped from pubkeys)", async () => {
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n-self",
        data: "02deadbeef",
        tags: [
          ["pubkeys", SERVER_PUBKEY],
          ["n_sigs", "2"],
          ["locktime", String(locktime)],
          ["refund", "02deadbeef"],
        ],
      },
    ])
    // bidder == seller == 02deadbeef; pubkeys contains only the server key
    const result = await verifyBid(
      bidPayload(secret, { bidder_pubkey: "02deadbeef", mint_url: "test://local" }),
      { ...auction, mint_url: "test://local" } as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects when n_sigs is not 2", async () => {
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n4",
        data: "02deadbeef",
        tags: [
          ["pubkeys", SERVER_PUBKEY, "03cafebabe"],
          ["n_sigs", "1"],
          ["locktime", String(locktime)],
          ["refund", "03cafebabe"],
        ],
      },
    ])
    const result = await verifyBid(bidPayload(secret), auction as never, undefined, SERVER_PUBKEY)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("P2PK_STRUCTURE_INVALID")
  })

  it("rejects when mint_url does not match the auction", async () => {
    const secret = makeP2PKSecret("02deadbeef", locktime, "03cafebabe", "n5")
    const result = await verifyBid(
      bidPayload(secret, { mint_url: "https://other.example" }),
      auction as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("MINT_URL_MISMATCH")
  })

  it("rejects legacy auctions with empty mint_url", async () => {
    const secret = makeP2PKSecret("02deadbeef", locktime, "03cafebabe", "n6")
    const legacy = { ...auction, mint_url: "" }
    const result = await verifyBid(bidPayload(secret), legacy as never, undefined, SERVER_PUBKEY)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("LEGACY_AUCTION")
  })

  it("rejects a mint_url with an unsafe scheme even when it matches the auction (MINT_URL_UNSAFE)", async () => {
    const secret = makeP2PKSecret("02deadbeef", locktime, "03cafebabe", "n-unsafe")
    const unsafe = { ...auction, mint_url: "http://mint.example" }
    const result = await verifyBid(
      bidPayload(secret, { mint_url: "http://mint.example" }),
      unsafe as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("MINT_URL_UNSAFE")
  })

  it("rejects a private-IP mint_url even when it matches the auction (MINT_URL_UNSAFE)", async () => {
    const secret = makeP2PKSecret("02deadbeef", locktime, "03cafebabe", "n-unsafe2")
    const unsafe = { ...auction, mint_url: "https://192.168.0.1" }
    const result = await verifyBid(
      bidPayload(secret, { mint_url: "https://192.168.0.1" }),
      unsafe as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("MINT_URL_UNSAFE")
  })

  it("accepts a well-formed standard P2PK bid against the test mint", async () => {
    const secret = makeP2PKSecret("02deadbeef", locktime, "03cafebabe", "n7")
    const result = await verifyBid(
      bidPayload(secret, { mint_url: "test://local" }),
      auction as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(true)
  })

  it("accepts a bid whose locktime is exactly ceil((end_time + 24h)/1000)", async () => {
    // Regression: the web bid form previously computed locktime with Math.floor,
    // which is always < the server's Math.ceil floor → every real bid was rejected
    // with LOCKTIME_TOO_EARLY. This test fails with floor and passes with ceil.
    const exactCeilLocktime = Math.ceil((auction.end_time + 24 * 3600_000) / 1000)
    const secret = makeP2PKSecret("02deadbeef", exactCeilLocktime, "03cafebabe", "n-ceil")
    const result = await verifyBid(
      bidPayload(secret, { mint_url: "test://local" }),
      auction as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects test://local bids when ALLOW_TEST_BIDS is off", async () => {
    const secret = makeP2PKSecret("02deadbeef", locktime, "03cafebabe", "n8")
    const prev = process.env.ALLOW_TEST_BIDS
    delete process.env.ALLOW_TEST_BIDS
    try {
      const result = await verifyBid(
        bidPayload(secret, { mint_url: "test://local" }),
        auction as never,
        undefined,
        SERVER_PUBKEY,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("MINT_URL_MISMATCH")
    } finally {
      if (prev !== undefined) process.env.ALLOW_TEST_BIDS = prev
    }
  })
})

describe("verifyBid mint checks", () => {
  const auction = {
    id: "mint-1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "ACTIVE" as const,
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "", // set per-test: checkMintCapabilities caches per mint URL
  }
  const locktime = Math.floor((auction.end_time + 24 * 3600_000) / 1000) + 100

  function payload(mintUrl: string) {
    const secret = makeP2PKSecret("02deadbeef", locktime, "03cafebabe", "m1")
    return {
      proofs: [{ id: "keyset1", amount: 200, secret, C: "c" }],
      mint_url: mintUrl,
      auction_id: "mint-1",
      amount: 200,
      bidder_pubkey: "03cafebabe",
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("rejects when the mint does not advertise NUT-11 (MINT_UNSUPPORTED)", async () => {
    const mintUrl = "https://mint1.example"
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === `${mintUrl}/v1/info`) {
        return {
          ok: true,
          json: async () => ({ nuts: { "4": { supported: true }, "5": { supported: true } } }),
        }
      }
      throw new Error("unexpected fetch " + url)
    })
    delete process.env.ALLOW_TEST_BIDS
    const result = await verifyBid(
      payload(mintUrl),
      { ...auction, mint_url: mintUrl } as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("MINT_UNSUPPORTED")
  })

  it("rejects when the mint info endpoint is unreachable (MINT_UNREACHABLE)", async () => {
    const mintUrl = "https://mint2.example"
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down")
    })
    delete process.env.ALLOW_TEST_BIDS
    const result = await verifyBid(
      payload(mintUrl),
      { ...auction, mint_url: mintUrl } as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("MINT_UNREACHABLE")
  })

  it("rejects an already-spent proof (PROOF_ALREADY_SPENT)", async () => {
    const mintUrl = "https://mint3.example"
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === `${mintUrl}/v1/info`) {
        return {
          ok: true,
          json: async () => ({
            nuts: {
              "4": { supported: true },
              "5": { supported: true },
              "7": { supported: true },
              "8": { supported: true },
              "10": { supported: true },
              "11": { supported: true },
            },
          }),
        }
      }
      if (url === `${mintUrl}/v1/checkstate`) {
        const body = JSON.parse(String(init?.body ?? "{}"))
        if (body.proofs) {
          return { ok: true, json: async () => ({ states: [{ Y: body.Ys[0], state: "SPENT", witness: null }] }) }
        }
        return { ok: false }
      }
      throw new Error("unexpected fetch " + url)
    })
    delete process.env.ALLOW_TEST_BIDS
    const result = await verifyBid(
      payload(mintUrl),
      { ...auction, mint_url: mintUrl } as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("PROOF_ALREADY_SPENT")
  })

  it("accepts a bid with a DLEQ even when DLEQ verification fails (best-effort)", async () => {
    const auction2 = { ...auction, id: "mint-dleq", mint_url: "https://mint-dleq.example" }
    const secret = makeP2PKSecret("02deadbeef", locktime, "03cafebabe", "dq1")
    const p = {
      proofs: [
        {
          id: "keyset1",
          amount: 200,
          secret,
          C: "c",
          dleq: { e: "02" + "ab".repeat(32), s: "cd".repeat(32) },
        },
      ],
      mint_url: "https://mint-dleq.example",
      auction_id: "mint-dleq",
      amount: 200,
      bidder_pubkey: "03cafebabe",
    }
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "https://mint-dleq.example/v1/info") {
        return { ok: true, json: async () => ({ nuts: { "4": { supported: true }, "5": { supported: true }, "7": { supported: true }, "8": { supported: true }, "10": { supported: true }, "11": { supported: true } } }) }
      }
      if (url === "https://mint-dleq.example/v1/keysets") {
        return { ok: true, json: async () => ({ keysets: [{ id: "keyset1", unit: "sat" }] }) }
      }
      if (url === "https://mint-dleq.example/v1/keys/keyset1") {
        return { ok: true, json: async () => ({ keysets: [{ id: "keyset1", unit: "sat", keys: { "200": "02" + "ab".repeat(32) } }] }) }
      }
      if (url === "https://mint-dleq.example/v1/checkstate") {
        return { ok: true, json: async () => ({ states: [{ Y: "y", state: "UNSPENT", witness: null }] }) }
      }
      throw new Error("unexpected fetch " + url)
    })
    delete process.env.ALLOW_TEST_BIDS
    const result = await verifyBid(p, auction2 as never, undefined, SERVER_PUBKEY)
    expect(result.ok).toBe(true)
  })
})
