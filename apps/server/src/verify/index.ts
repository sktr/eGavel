import { Mint } from "@cashu/cashu-ts"
import { getSecretKind, getDataField, getTag } from "@cashu/cashu-ts"
import { hashToCurve } from "@cashu/cashu-ts"
import type { Auction } from "@cashu-auction/shared"

const LOCKTIME_MARGIN_MS = 24 * 60 * 60 * 1000
const END_TIME_MARGIN_MS = 30_000
const TEST_MINT_URL = "test://local"

export interface BidPayload {
  proof: {
    id: string
    amount: number
    secret: string
    C: string
  }
  mint_url: string
  auction_id: string
  amount: number
  bidder_pubkey: string
}

export type VerifyError =
  | { code: "INVALID_SECRET_FORMAT"; message: string }
  | { code: "NOT_P2PK_SECRET" }
  | { code: "PUBKEY_MISMATCH"; expected: string; actual: string }
  | { code: "LOCKTIME_TOO_EARLY"; locktime: number; required: number }
  | { code: "REFUND_MISMATCH"; expected: string }
  | { code: "AMOUNT_MISMATCH"; proofAmount: number; claimedAmount: number }
  | { code: "BELOW_START_PRICE"; amount: number; startPrice: number }
  | { code: "BELOW_HIGHEST_BID"; amount: number; highestBid: number }
  | { code: "PROOF_ALREADY_SPENT" }
  | { code: "AUCTION_NOT_FOUND" }
  | { code: "AUCTION_NOT_ACTIVE"; state: string }
  | { code: "TOO_LATE"; endTime: number; margin: number }
  | { code: "MINT_ERROR"; message: string }

export type VerifyResult =
  | { ok: true; Y: string }
  | { ok: false; error: VerifyError }

function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

export function computeY(secret: string): string {
  const point = hashToCurve(utf8Encode(secret))
  return point.toHex()
}

export function parseP2PKSecret(
  secret: string,
): { data: string; locktime: number; refund: string } | VerifyError {
  let kind: string
  try {
    kind = getSecretKind(secret)
  } catch {
    return {
      code: "INVALID_SECRET_FORMAT",
      message: "cannot parse secret",
    }
  }
  if (kind !== "P2PK") {
    return { code: "NOT_P2PK_SECRET" }
  }

  let data: string
  try {
    data = getDataField(secret)
  } catch {
    return {
      code: "INVALID_SECRET_FORMAT",
      message: "cannot read data field",
    }
  }
  if (!data) {
    return {
      code: "INVALID_SECRET_FORMAT",
      message: "missing data field",
    }
  }

  let locktimeTag: string[] | undefined
  try {
    locktimeTag = getTag(secret, "locktime")
  } catch {
    return {
      code: "INVALID_SECRET_FORMAT",
      message: "cannot read locktime tag",
    }
  }
  const locktimeStr = locktimeTag?.[0]
  const locktime = locktimeStr ? Number(locktimeStr) : 0
  if (!locktime || isNaN(locktime)) {
    return {
      code: "INVALID_SECRET_FORMAT",
      message: "missing or invalid locktime tag",
    }
  }

  let refundTag: string[] | undefined
  try {
    refundTag = getTag(secret, "refund")
  } catch {
    return {
      code: "INVALID_SECRET_FORMAT",
      message: "cannot read refund tag",
    }
  }
  const refund = refundTag?.join(",") ?? ""
  if (!refund) {
    return {
      code: "INVALID_SECRET_FORMAT",
      message: "missing refund tag",
    }
  }

  return { data, locktime, refund }
}

export async function verifyBid(
  payload: BidPayload,
  auction: Auction,
  currentHighestBid?: number,
): Promise<VerifyResult> {
  if (auction.state !== "ACTIVE" && auction.state !== "EXTENDED") {
    return {
      ok: false,
      error: { code: "AUCTION_NOT_ACTIVE", state: auction.state },
    }
  }

  const maxArrivalTime = auction.end_time + END_TIME_MARGIN_MS
  if (Date.now() > maxArrivalTime) {
    return {
      ok: false,
      error: { code: "TOO_LATE", endTime: auction.end_time, margin: END_TIME_MARGIN_MS },
    }
  }

  if (payload.amount < auction.start_price) {
    return {
      ok: false,
      error: {
        code: "BELOW_START_PRICE",
        amount: payload.amount,
        startPrice: auction.start_price,
      },
    }
  }

  if (currentHighestBid !== undefined && payload.amount <= currentHighestBid) {
    return {
      ok: false,
      error: {
        code: "BELOW_HIGHEST_BID",
        amount: payload.amount,
        highestBid: currentHighestBid,
      },
    }
  }

  if (payload.proof.amount !== payload.amount) {
    return {
      ok: false,
      error: {
        code: "AMOUNT_MISMATCH",
        proofAmount: payload.proof.amount,
        claimedAmount: payload.amount,
      },
    }
  }

  let parsed: ReturnType<typeof parseP2PKSecret>
  try {
    parsed = parseP2PKSecret(payload.proof.secret)
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "INVALID_SECRET_FORMAT",
        message: String(err),
      },
    }
  }

  if ("code" in parsed) {
    return { ok: false, error: parsed }
  }

  if (parsed.data !== auction.seller_pubkey) {
    return {
      ok: false,
      error: {
        code: "PUBKEY_MISMATCH",
        expected: auction.seller_pubkey,
        actual: parsed.data,
      },
    }
  }

  const requiredLocktime = Math.floor((auction.end_time + LOCKTIME_MARGIN_MS) / 1000)
  if (parsed.locktime < requiredLocktime) {
    return {
      ok: false,
      error: {
        code: "LOCKTIME_TOO_EARLY",
        locktime: parsed.locktime,
        required: requiredLocktime,
      },
    }
  }

  if (!parsed.refund.includes(payload.bidder_pubkey)) {
    return {
      ok: false,
      error: {
        code: "REFUND_MISMATCH",
        expected: payload.bidder_pubkey,
      },
    }
  }

  let Y: string
  try {
    Y = computeY(payload.proof.secret)
  } catch {
    return {
      ok: false,
      error: { code: "INVALID_SECRET_FORMAT", message: "failed to compute Y" },
    }
  }

  // Test mode: skip the external mint check
  if (payload.mint_url !== TEST_MINT_URL) {
    try {
      const mint = new Mint(payload.mint_url)
      const result = await mint.check({ Ys: [Y] })
      const state = result.states[0]?.state
      if (state !== "UNSPENT") {
        return { ok: false, error: { code: "PROOF_ALREADY_SPENT" } }
      }
    } catch (err) {
      return {
        ok: false,
        error: { code: "MINT_ERROR", message: String(err) },
      }
    }
  }

  return { ok: true, Y }
}
