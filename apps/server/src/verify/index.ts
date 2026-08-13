import { Mint } from "@cashu/cashu-ts"
import { getSecretKind, getDataField, getTag } from "@cashu/cashu-ts"
import { hashToCurve } from "@cashu/cashu-ts"
import type { Auction } from "@egavel/shared"
import { canonicalPubkey } from "../lib/canonical.js"
import { hasValidDleq } from "@cashu/cashu-ts"
import type { Proof } from "@cashu/cashu-ts"

const LOCKTIME_MARGIN_MS = 24 * 60 * 60 * 1000
const END_TIME_MARGIN_MS = 30_000
const TEST_MINT_URL = "test://local"

export interface BidPayloadProof {
  id: string
  amount: number
  secret: string
  C: string
  dleq?: { e: string; s: string }
}

export interface BidPayload {
  proofs: BidPayloadProof[]
  mint_url: string
  auction_id: string
  amount: number
  bidder_pubkey: string
}

export type VerifyError =
  | { code: "INVALID_SECRET_FORMAT"; message: string }
  | { code: "NOT_P2PK_SECRET" }
  | { code: "PUBKEY_MISMATCH"; expected: string; actual: string }
  | { code: "SERVER_KEY_MISMATCH"; detail?: { pubkeys: string[]; expectedServer: string | null; bidder: string } }
  | { code: "P2PK_STRUCTURE_INVALID"; message: string }
  | { code: "SIGFLAG_NOT_INPUTS"; flag: string }
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
  | { code: "MINT_URL_MISMATCH"; expected: string; actual: string }
  | { code: "LEGACY_AUCTION" }
  | { code: "MINT_UNSUPPORTED"; missing: string[] }
  | { code: "MINT_UNREACHABLE"; message: string }

export type VerifyResult =
  | { ok: true; Ys: string[] }
  | { ok: false; error: VerifyError }

function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

export function computeY(secret: string): string {
  const point = hashToCurve(utf8Encode(secret))
  return point.toHex()
}

export interface ParsedP2PK {
  data: string
  pubkeys: string[]
  nSigs: number
  sigflag: string | null
  locktime: number
  refund: string
}

export function parseP2PKSecret(
  secret: string,
): ParsedP2PK | VerifyError {
  let kind: string
  try {
    kind = getSecretKind(secret)
  } catch {
    return { code: "INVALID_SECRET_FORMAT", message: "cannot parse secret" }
  }
  if (kind !== "P2PK") return { code: "NOT_P2PK_SECRET" }

  let data: string
  try {
    data = getDataField(secret)
  } catch {
    return { code: "INVALID_SECRET_FORMAT", message: "cannot read data field" }
  }
  if (!data) return { code: "INVALID_SECRET_FORMAT", message: "missing data field" }

  let locktimeTag: string[] | undefined
  try {
    locktimeTag = getTag(secret, "locktime")
  } catch {
    return { code: "INVALID_SECRET_FORMAT", message: "cannot read locktime tag" }
  }
  const locktime = locktimeTag?.[0] ? Number(locktimeTag[0]) : 0
  if (!locktime || isNaN(locktime)) {
    return { code: "INVALID_SECRET_FORMAT", message: "missing or invalid locktime tag" }
  }

  let refundTag: string[] | undefined
  try {
    refundTag = getTag(secret, "refund")
  } catch {
    return { code: "INVALID_SECRET_FORMAT", message: "cannot read refund tag" }
  }
  const refund = refundTag?.join(",") ?? ""
  if (!refund) return { code: "INVALID_SECRET_FORMAT", message: "missing refund tag" }

  let sigflag: string | null = null
  try {
    const f = getTag(secret, "sigflag")?.[0]
    sigflag = f ?? null
  } catch {
    // treat as absent
  }
  if (sigflag !== null && sigflag !== "SIG_INPUTS") {
    return { code: "SIGFLAG_NOT_INPUTS", flag: sigflag }
  }

  let pubkeys: string[] = []
  try {
    const tag = getTag(secret, "pubkeys")
    pubkeys = tag ?? []
  } catch {
    pubkeys = []
  }

  let nSigs = 1
  try {
    const n = getTag(secret, "n_sigs")?.[0]
    if (n !== undefined) nSigs = Number(n)
  } catch {
    // default 1
  }

  return { data, pubkeys, nSigs, sigflag, locktime, refund }
}

// NUT-06 capability cache: mintUrl -> { ok: boolean; at: number }
const infoCache = new Map<string, { ok: boolean; at: number }>()
const INFO_TTL_MS = 60 * 60 * 1000

async function checkMintCapabilities(mintUrl: string): Promise<{ ok: boolean; missing?: string[] }> {
  const cached = infoCache.get(mintUrl)
  if (cached && Date.now() - cached.at < INFO_TTL_MS) {
    return cached.ok ? { ok: true } : { ok: false }
  }
  try {
    const res = await fetch(`${mintUrl}/v1/info`)
    if (!res.ok) throw new Error(`info HTTP ${res.status}`)
    const info = (await res.json()) as { nuts?: Record<string, { supported?: boolean }> }
    const required = ["7", "8", "10", "11"]
    const missing = required.filter((n) => !info.nuts?.[n]?.supported)
    const ok = missing.length === 0
    infoCache.set(mintUrl, { ok, at: Date.now() })
    return ok ? { ok: true } : { ok: false, missing }
  } catch (err) {
    infoCache.set(mintUrl, { ok: false, at: Date.now() })
    throw err
  }
}

export async function verifyBid(
  payload: BidPayload,
  auction: Auction,
  currentPrice?: number,
  serverPubkey?: string,
): Promise<VerifyResult> {
  if (auction.state !== "ACTIVE" && auction.state !== "EXTENDED") {
    return { ok: false, error: { code: "AUCTION_NOT_ACTIVE", state: auction.state } }
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
      error: { code: "BELOW_START_PRICE", amount: payload.amount, startPrice: auction.start_price },
    }
  }

  // payload.amount is the bidder's MAX (proxy bidding). A max at or below the
  // current standing price can never take the lead.
  if (currentPrice !== undefined && payload.amount <= currentPrice) {
    return {
      ok: false,
      error: { code: "BELOW_HIGHEST_BID", amount: payload.amount, highestBid: currentPrice },
    }
  }

  // The locked value (sum of all proofs, incl. the future-spend fee the bidder
  // paid upfront) must cover the bid amount. cashu-ts splits sends into
  // denomination proofs, so a bid is a bundle of proofs.
  const totalProofAmount = payload.proofs.reduce((a, p) => a + p.amount, 0)
  if (totalProofAmount < payload.amount) {
    return {
      ok: false,
      error: {
        code: "AMOUNT_MISMATCH",
        proofAmount: totalProofAmount,
        claimedAmount: payload.amount,
      },
    }
  }

  // ── mint selection ──────────────────────────────
  const allowTest = process.env.ALLOW_TEST_BIDS === "1"
  const isTestMint = payload.mint_url === TEST_MINT_URL

  if (auction.mint_url === "") {
    return { ok: false, error: { code: "LEGACY_AUCTION" } }
  }
  if (!allowTest || !isTestMint) {
    if (payload.mint_url !== auction.mint_url) {
      return {
        ok: false,
        error: { code: "MINT_URL_MISMATCH", expected: auction.mint_url, actual: payload.mint_url },
      }
    }
  }

  // ── P2PK structure (per proof) ──────────────────
  const requiredLocktime = Math.ceil((auction.end_time + LOCKTIME_MARGIN_MS) / 1000)
  const Ys: string[] = []
  for (const proof of payload.proofs) {
    let parsed: ParsedP2PK | VerifyError
    try {
      parsed = parseP2PKSecret(proof.secret)
    } catch (err) {
      return { ok: false, error: { code: "INVALID_SECRET_FORMAT", message: String(err) } }
    }
    if ("code" in parsed) return { ok: false, error: parsed }

    if (canonicalPubkey(parsed.data) !== canonicalPubkey(auction.seller_pubkey)) {
      return {
        ok: false,
        error: {
          code: "PUBKEY_MISMATCH",
          expected: auction.seller_pubkey,
          actual: parsed.data,
        },
      }
    }

    // 2-of-3: the lock key set is {seller (data), server, bidder}. The bidder may
    // appear in `pubkeys` OR, when the bidder == seller, be the `data` key itself
    // (cashu-ts dedupes the data key out of pubkeys).
    const pubkeysCanon = parsed.pubkeys.map(canonicalPubkey)
    const bidderInLock =
      canonicalPubkey(parsed.data) === canonicalPubkey(payload.bidder_pubkey) ||
      pubkeysCanon.includes(canonicalPubkey(payload.bidder_pubkey))
    if (!serverPubkey || !pubkeysCanon.includes(canonicalPubkey(serverPubkey)) || !bidderInLock) {
      return {
        ok: false,
        error: {
          code: "SERVER_KEY_MISMATCH",
          detail: {
            pubkeys: parsed.pubkeys.map((p) => p.slice(0, 12)),
            expectedServer: serverPubkey ? serverPubkey.slice(0, 12) : null,
            bidder: payload.bidder_pubkey.slice(0, 12),
          },
        },
      }
    }

    if (parsed.nSigs !== 2) {
      return { ok: false, error: { code: "P2PK_STRUCTURE_INVALID", message: `n_sigs=${parsed.nSigs} (expected 2)` } }
    }

    if (parsed.locktime < requiredLocktime) {
      return {
        ok: false,
        error: { code: "LOCKTIME_TOO_EARLY", locktime: parsed.locktime, required: requiredLocktime },
      }
    }

    if (!parsed.refund.split(",").map(canonicalPubkey).includes(canonicalPubkey(payload.bidder_pubkey))) {
      return { ok: false, error: { code: "REFUND_MISMATCH", expected: payload.bidder_pubkey } }
    }

    try {
      Ys.push(computeY(proof.secret))
    } catch {
      return { ok: false, error: { code: "INVALID_SECRET_FORMAT", message: "failed to compute Y" } }
    }
  }

  if (allowTest && isTestMint) {
    return { ok: true, Ys }
  }

  // ── mint reachability + NUT-06 ───────────────────
  try {
    const caps = await checkMintCapabilities(payload.mint_url)
    if (!caps.ok) {
      return { ok: false, error: { code: "MINT_UNSUPPORTED", missing: caps.missing ?? [] } }
    }
  } catch (err) {
    return { ok: false, error: { code: "MINT_UNREACHABLE", message: String(err) } }
  }

  // ── best-effort DLEQ (NUT-12) ────────────────────
  for (const proof of payload.proofs) {
    if (!proof.dleq) continue
    try {
      const ksRes = await fetch(`${payload.mint_url}/v1/keysets`)
      if (!ksRes.ok) throw new Error(`keysets HTTP ${ksRes.status}`)
      const { keysets } = (await ksRes.json()) as { keysets: { id: string }[] }
      const keyset = keysets.find((k) => k.id === proof.id)
      if (keyset) {
        const kRes = await fetch(`${payload.mint_url}/v1/keys/${keyset.id}`)
        if (!kRes.ok) throw new Error(`keys HTTP ${kRes.status}`)
        const data = (await kRes.json()) as { keysets?: { id: string; keys: Record<string, string> }[] }
        const pub = data.keysets?.[0]?.keys[String(proof.amount)]
        if (pub) {
          const dleqOk = hasValidDleq(
            proof as unknown as Proof,
            { id: proof.id, keys: { [proof.amount]: pub } },
            { require: false },
          )
          if (!dleqOk) {
            console.warn(`bid ${payload.auction_id}: DLEQ verification failed (best-effort, not rejected)`)
          }
        }
      }
    } catch (err) {
      console.warn(`bid ${payload.auction_id}: DLEQ check skipped (best-effort): ${String(err)}`)
    }
  }

  // ── NUT-07 unspent check (best-effort with proofs, spec §4.1.9) ──
  try {
    const mint = new Mint(payload.mint_url)
    let states: string[] = []
    // Some mints validate the supplied proofs (detecting forgeries). Best-effort:
    // if the mint rejects the extra field, fall back to the plain Ys check.
    try {
      const res = await fetch(`${payload.mint_url}/v1/checkstate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Ys, proofs: payload.proofs }),
      })
      if (res.ok) {
        const data = (await res.json()) as { states?: { state?: string }[] }
        states = (data.states ?? []).map((s) => s.state ?? "")
      }
    } catch {
      // mint does not accept proofs — fall through to the cashu-ts check
    }
    if (states.length === 0) {
      const result = await mint.check({ Ys })
      states = result.states.map((s) => s.state)
    }
    if (states.some((st) => st !== "UNSPENT")) {
      return { ok: false, error: { code: "PROOF_ALREADY_SPENT" } }
    }
  } catch (err) {
    return { ok: false, error: { code: "MINT_ERROR", message: String(err) } }
  }

  return { ok: true, Ys }
}
