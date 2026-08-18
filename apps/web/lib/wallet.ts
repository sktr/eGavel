"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Wallet,
  Amount,
  serializeProofs,
  deserializeProofs,
  sumProofs,
  getTokenMetadata,
  type Proof,
  type P2PKOptions,
  type MintQuoteBolt11Response,
} from "@cashu/cashu-ts"
import { buildWallet } from "./deterministic-wallet"
import { loadAccount } from "./key-store"

const LEGACY_KEY = "cashu-wallet-v1";
/** Set once the legacy shared store has been claimed by an account. */
const MIGRATED_FLAG = "cashu-wallet-v1:migrated";

/** Wallet proof store is namespaced per account so two accounts in one
 * browser never see (or spend) each other's proofs. */
function walletStoreKey(pubkey: string): string {
  return `${LEGACY_KEY}:${pubkey}`;
}

/**
 * Fired whenever the local wallet store changes (bid placed, refund recovered,
 * token received, claim/change collected). Header and dashboard balance
 * displays listen for it so they refresh immediately instead of only on mount.
 */
export const WALLET_CHANGED_EVENT = "egavel:wallet-changed"

function notifyWalletChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WALLET_CHANGED_EVENT));
}

interface WalletStore {
  [mintUrl: string]: string[]
}

export function loadStore(pubkey: string): WalletStore {
  const key = walletStoreKey(pubkey);
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) ?? {}
    // Legacy migration: the pre-namespacing store is claimed once, by the
    // first account that touches it, then never read again — so a second
    // account on the same browser cannot inherit another account's proofs.
    if (localStorage.getItem(MIGRATED_FLAG) === null) {
      const legacy = localStorage.getItem(LEGACY_KEY)
      localStorage.setItem(MIGRATED_FLAG, "1")
      if (legacy !== null) {
        localStorage.setItem(key, legacy)
        return JSON.parse(legacy) ?? {}
      }
    }
    return {}
  } catch {
    return {}
  }
}

function saveStore(pubkey: string, data: WalletStore) {
  localStorage.setItem(walletStoreKey(pubkey), JSON.stringify(data))
  // Every mutation funnels through here (receive/sendP2PK/claimMint/refresh/
  // storeProofsInWallet) — one dispatch point keeps every balance UI in sync.
  notifyWalletChanged()
}

/**
 * Write the store WITHOUT firing WALLET_CHANGED_EVENT. Used for internal
 * self-healing writes (e.g. useTotalBalance dropping mint-confirmed spent
 * proofs) where the caller already owns the UI refresh — dispatching here
 * would re-trigger the caller and loop.
 */
function saveStoreQuiet(pubkey: string, data: WalletStore) {
  localStorage.setItem(walletStoreKey(pubkey), JSON.stringify(data))
}

export function useWallet(mintUrl: string, pubkey: string) {
  const walletRef = useRef<Wallet | null>(null)
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Optimistic first paint: show the locally-stored balance immediately so the
  // UI never flashes "0 sats" while loadMint + groupProofsByState run. The
  // mint verification below corrects the number if any proof is spent.
  useEffect(() => {
    if (!mintUrl || !pubkey) return
    const store = loadStore(pubkey)
    const raw = store[mintUrl] ?? []
    let local = 0
    for (const s of raw) {
      try {
        local += Number(JSON.parse(s).amount ?? 0)
      } catch {
        // unparseable entry — skip
      }
    }
    setBalance(local)
  }, [mintUrl, pubkey])

  // ── Init ──────────────────────────────────────────────
  useEffect(() => {
    if (!mintUrl || !pubkey) {
      setLoading(false)
      return
    }
    let cancelled = false

    ;(async () => {
      try {
        const wallet = buildWallet(mintUrl)
        await wallet.loadMint()
        if (cancelled) return
        walletRef.current = wallet

        const store = loadStore(pubkey)
        const raw = store[mintUrl] ?? []

        if (raw.length > 0) {
          const stored = deserializeProofs(raw)
          const { unspent } = await wallet.groupProofsByState(stored)
          store[mintUrl] = serializeProofs(unspent)
          saveStore(pubkey, store)
          setBalance(unspent.length > 0 ? Number(sumProofs(unspent)) : 0)
        } else {
          setBalance(0)
        }

        setReady(true)
      } catch (err) {
        if (!cancelled) {
          // mint unreachable (network / mint down / DNS) — surface a clear,
          // actionable message instead of a raw fetch error.
          setError(
            `mint unreachable (${mintUrl}) — check your connection; the mint may be down.`,
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mintUrl, pubkey])

  // ── Receive ──────────────────────────────────────────
  const receive = useCallback(
    async (tokenStr: string): Promise<{ mint: string; amount: number }> => {
      // Determine the token's mint
      let tokenMint: string
      let proofsOverride: Proof[] | null = null
      try {
        const meta = getTokenMetadata(tokenStr)
        tokenMint = meta.mint
      } catch {
        // If getTokenMetadata fails, try as raw JSON (v3 token format)
        try {
          const parsed = JSON.parse(tokenStr)
          const entry = Array.isArray(parsed.token)
            ? parsed.token[0]
            : parsed
          tokenMint = entry?.mint ?? entry?.mint_url ?? mintUrl
          // v3 tokens carry plain proofs — cashu-ts can't parse the JSON string
          // itself, so hand it the proofs array instead.
          if (Array.isArray(entry?.proofs)) {
            proofsOverride = entry.proofs as Proof[]
          }
        } catch {
          tokenMint = mintUrl
        }
      }

      if (!tokenMint) throw new Error("Could not determine mint URL from token")

      // Create wallet for the token's mint (may differ from current wallet)
      const receiveWallet =
        tokenMint === mintUrl && walletRef.current
          ? walletRef.current
          : buildWallet(tokenMint)

      if (receiveWallet !== walletRef.current) {
        await receiveWallet.loadMint()
      }

      const input: string | Proof[] = proofsOverride ?? tokenStr
      const newProofs = await receiveWallet.receive(input as never)
      const total = newProofs.length > 0 ? Number(sumProofs(newProofs)) : 0

      // Store under the token's mint
      const store = loadStore(pubkey)
      const existing = deserializeProofs(store[tokenMint] ?? [])
      store[tokenMint] = serializeProofs([...existing, ...newProofs])
      saveStore(pubkey, store)

      // If this is the active mint, update balance
      if (tokenMint === mintUrl) {
        const refreshed = deserializeProofs(store[tokenMint] ?? [])
        setBalance(refreshed.length > 0 ? Number(sumProofs(refreshed)) : 0)
      }

      return { mint: tokenMint, amount: total }
    },
    [mintUrl, pubkey],
  )

  // ── Send P2PK ────────────────────────────────────────
  const sendP2PK = useCallback(
    async (
      amount: number,
      options: P2PKOptions,
    ): Promise<{ proofs: Proof[]; change: Proof[] }> => {
      const wallet = walletRef.current
      if (!wallet) throw new Error("Wallet not initialized")

      const store = loadStore(pubkey)
      const stored = deserializeProofs(store[mintUrl] ?? [])
      const { unspent } = await wallet.groupProofsByState(stored)

      if (unspent.length === 0) throw new Error("No unspent proofs available")

      // The store may hold P2PK-locked proofs (winner change, seller claim)
      // that this wallet owns 1-of-1. Sign them so the mint accepts the swap
      // — otherwise it rejects with "Witness signatures not provided".
      const skHex = walletPrivkeyHex(pubkey)
      const sendOp = wallet.ops
        .send(Amount.from(amount), unspent)
        .asP2PK(options)
        .includeFees(true)
      if (skHex) sendOp.privkey(skHex)
      const result = await sendOp.run()

      // Replace (not merge): the swap consumed the input proofs at the mint;
      // keeping them would inflate the optimistic balance while the mint is
      // unreachable. Mirrors replaceMintProofs semantics.
      store[mintUrl] = serializeProofs(result.keep)
      saveStore(pubkey, store)

      setBalance(
        result.keep.length > 0 ? Number(sumProofs(result.keep)) : 0,
      )

      if (result.send.length === 0) throw new Error("send produced no output proofs")
      return { proofs: result.send, change: result.keep }
    },
    [mintUrl, pubkey],
  )

  // ── Mint (faucet) ─────────────────────────────────────
  const requestMint = useCallback(
    async (
      amount: number,
    ): Promise<MintQuoteBolt11Response> => {
      const wallet = walletRef.current
      if (!wallet) throw new Error("Wallet not initialized")
      return wallet.createMintQuoteBolt11(amount, "eGavel bid")
    },
    [mintUrl, pubkey],
  )

  const checkMintQuote = useCallback(
    async (
      quoteId: string,
    ): Promise<MintQuoteBolt11Response> => {
      const wallet = walletRef.current
      if (!wallet) throw new Error("Wallet not initialized")
      return wallet.checkMintQuoteBolt11(quoteId)
    },
    [mintUrl, pubkey],
  )

  const claimMint = useCallback(
    async (
      amount: number,
      quote: MintQuoteBolt11Response,
    ): Promise<Proof[]> => {
      const wallet = walletRef.current
      if (!wallet) throw new Error("Wallet not initialized")

      const proofs = await wallet.mintProofsBolt11(
        Amount.from(amount),
        quote,
      )

      // Store minted proofs
      const store = loadStore(pubkey)
      const existing = deserializeProofs(store[mintUrl] ?? [])
      store[mintUrl] = serializeProofs([...existing, ...proofs])
      saveStore(pubkey, store)

      const refreshed = deserializeProofs(store[mintUrl] ?? [])
      setBalance(refreshed.length > 0 ? Number(sumProofs(refreshed)) : 0)

      return proofs
    },
    [mintUrl, pubkey],
  )

  // ── Refresh ──────────────────────────────────────────
  const refresh = useCallback(async () => {
    const wallet = walletRef.current
    if (!wallet) return

    const store = loadStore(pubkey)
    const stored = deserializeProofs(store[mintUrl] ?? [])
    const { unspent } = await wallet.groupProofsByState(stored)
    store[mintUrl] = serializeProofs(unspent)
    saveStore(pubkey, store)
    setBalance(unspent.length > 0 ? Number(sumProofs(unspent)) : 0)
  }, [mintUrl, pubkey])

  return { balance, loading, error, ready, receive, sendP2PK, refresh, requestMint, checkMintQuote, claimMint }
}

export function storeProofsInWallet(proofs: Proof[], mintUrl: string, pubkey: string) {
  const store = loadStore(pubkey)
  const existing = deserializeProofs(store[mintUrl] ?? [])
  // Dedupe by C (the point): auto-collect / two tabs may re-fetch the same
  // change proofs; storing them twice would double the displayed balance and
  // leave a stale (spent) copy behind after the first one is used.
  const seen = new Set(existing.map((p) => p.C))
  const fresh = proofs.filter((p) => !seen.has(p.C))
  store[mintUrl] = serializeProofs([...existing, ...fresh])
  // Always go through saveStore so balance UIs still get the refresh event
  // even when nothing new was added (existing dispatch contract).
  saveStore(pubkey, store)
}

/**
 * Replace a mint's proofs in the store with an exact set — used after a swap
 * that CONSUMED input proofs (withdraw, melt). Merging via storeProofsInWallet
 * would keep the spent proofs, so when the mint is unreachable the optimistic
 * balance over-counts them (the "stale previous number" bug). Replacement
 * mirrors what sendP2PK already did for bids.
 */
export function replaceMintProofs(proofs: Proof[], mintUrl: string, pubkey: string) {
  const store = loadStore(pubkey)
  store[mintUrl] = serializeProofs(proofs)
  saveStore(pubkey, store)
}

// ── Total balance across all mints in the local wallet store ──────────────
export interface MintBalance {
  mint: string
  amount: number
}

/**
 * Sum the amounts of serialized proof JSON strings without touching the mint
 * server. Used for the optimistic first paint so the header/dashboard/wallet
 * never flash "0 sats" while the (slow) mint verification runs.
 *
 * P2PK-locked proofs (e.g. an unspent winner change still locked to the
 * winner's key) are NOT spendable as ordinary proofs, so they are excluded —
 * otherwise the optimistic balance over-counts until the mint can be reached
 * to swap them.
 */
export function sumStoredAmounts(raw: string[]): number {
  if (raw.length === 0) return 0
  let total = 0
  for (const s of raw) {
    try {
      const p = JSON.parse(s) as { amount?: number; secret?: string }
      if (typeof p.secret === "string" && isP2PKSecret(p.secret)) continue
      total += Number(p.amount ?? 0)
    } catch {
      // unparseable entry — skip
    }
  }
  return total
}

/** True when a proof secret is a NUT-11 P2PK lock (1-of-1 winner change,
 * 2-of-3 bid, etc.) — such proofs need a witness to spend. */
export function isP2PKSecret(secret: string): boolean {
  try {
    const parsed = JSON.parse(secret) as unknown
    return Array.isArray(parsed) && parsed[0] === "P2PK"
  } catch {
    return false
  }
}

/** Filter P2PK-locked proofs out of an unspent list: the wallet cannot spend
 * them as ordinary proofs (a witness is required), so handing them to
 * send/melt fails at the mint with "Witness signatures not provided". */
export function unspentWithoutP2PK(proofs: Proof[]): Proof[] {
  return proofs.filter((p) => typeof p.secret !== "string" || !isP2PKSecret(p.secret))
}

export interface MintVerifyResult {
  mint: string
  amount: number
  /** false = mint unreachable — the optimistic local estimate is kept. */
  ok: boolean
}

export interface MergedBalance {
  byMint: MintBalance[]
  total: number
  /** True when at least one mint could not be verified (stale estimate shown). */
  stale: boolean
}

/**
 * Merge per-mint verification results with the optimistic local estimates.
 * Verified mints contribute their mint-confirmed amount; unreachable mints
 * keep the local estimate and mark the result stale so the UI can warn that
 * the number is not mint-confirmed.
 */
export function mergeMintBalances(
  localByMint: MintBalance[],
  results: MintVerifyResult[],
): MergedBalance {
  const byMint: MintBalance[] = []
  let stale = false
  for (const r of results) {
    if (r.ok) {
      if (r.amount > 0) byMint.push({ mint: r.mint, amount: r.amount })
    } else {
      stale = true
      const local = localByMint.find((m) => m.mint === r.mint)
      if (local && local.amount > 0) byMint.push(local)
    }
  }
  return { byMint, total: byMint.reduce((acc, m) => acc + m.amount, 0), stale }
}

/**
 * The account's secret key (hex) when it matches the pubkey the wallet is
 * operating on — used to sign P2PK witnesses (winner change, seller claim)
 * before spending them at the mint. Returns null for a logged-out or
 * mismatched account so spend flows can skip signing.
 */
export function walletPrivkeyHex(pubkey: string): string | null {
  const account = loadAccount()
  if (!account || account.pubkey !== pubkey) return null
  return account.secretKeyHex
}

/**
 * Decide which mint's balance a withdraw should spend from.
 *
 * Withdraws are per-mint: a Cashu token is mint-specific, and a Lightning
 * melt is paid with one mint's proofs. The wallet store may hold balances on
 * several mints (Receive accepts tokens from any mint), so the user picks one
 * and we fall back sanely when their pick is empty.
 *
 * Priority: the user's selection (if it holds sats) → the first mint with
 * balance → the app default mint (so the legacy single-mint behaviour
 * "withdraw from the fixed mint" is preserved when nothing else exists).
 */
/**
 * A withdraw that has been SENT at the mint but whose token the user has not
 * yet copied/exported. The input proofs are spent at the mint the moment the
 * send runs, so the only copy of the funds is this token — it MUST survive a
 * reload, otherwise the money is lost forever.
 */
export interface PendingWithdrawal {
  token: string
  mint: string
  amount: number
  createdAt: number
}

const PENDING_WD_KEY = "egavel-pending-withdrawals"

export function savePendingWithdrawal(entry: PendingWithdrawal) {
  try {
    const all = loadPendingWithdrawals()
    // Dedupe by token — re-running the same withdraw must not duplicate.
    if (all.some((w) => w.token === entry.token)) return
    all.push(entry)
    localStorage.setItem(PENDING_WD_KEY, JSON.stringify(all))
  } catch {
    // storage unavailable — the token lives only in state
  }
}

export function loadPendingWithdrawals(): PendingWithdrawal[] {
  try {
    const raw = localStorage.getItem(PENDING_WD_KEY)
    const parsed = raw ? (JSON.parse(raw) as PendingWithdrawal[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function removePendingWithdrawal(token: string) {
  try {
    const all = loadPendingWithdrawals().filter((w) => w.token !== token)
    localStorage.setItem(PENDING_WD_KEY, JSON.stringify(all))
  } catch {
    // storage unavailable — ignore
  }
}

export function pickWithdrawMint(  byMint: MintBalance[],
  selected: string | null,
  fallback: string,
): string {
  if (selected) {
    const picked = byMint.find((m) => m.mint === selected)
    if (picked && picked.amount > 0) return selected
  }
  const funded = byMint.find((m) => m.amount > 0)
  return funded ? funded.mint : fallback
}

export function useTotalBalance(pubkey: string) {
  const [total, setTotal] = useState(0)
  const [byMint, setByMint] = useState<MintBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // True when at least one mint could not be reached: the displayed number is
  // the local estimate, not a mint-confirmed balance.
  const [stale, setStale] = useState(false)

  const load = useCallback(async () => {
    if (!pubkey) {
      setTotal(0)
      setByMint([])
      setLoading(false)
      setRefreshing(false)
      setStale(false)
      return
    }
    const store = loadStore(pubkey)
    const entries = Object.entries(store).filter(([, proofs]) => proofs.length > 0)
    if (entries.length === 0) {
      setTotal(0)
      setByMint([])
      setLoading(false)
      setRefreshing(false)
      setStale(false)
      return
    }

    // Optimistic first paint: show the locally-stored sums immediately, then
    // correct them with mint verification below. Avoids the "0 → balance"
    // flash on every load (initial mount, refresh, WALLET_CHANGED_EVENT).
    const localByMint = entries
      .map(([mint, raw]): MintBalance => ({ mint, amount: sumStoredAmounts(raw) }))
      .filter((m) => m.amount > 0)
    setByMint(localByMint)
    setTotal(localByMint.reduce((acc, r) => acc + r.amount, 0))
    setLoading(false)

    const results = await Promise.all(
      entries.map(async ([mint, raw]): Promise<MintVerifyResult> => {
        try {
          const wallet = buildWallet(mint)
          await wallet.loadMint()
          const stored = deserializeProofs(raw)
          const { unspent } = await wallet.groupProofsByState(stored)
          const amount = unspent.length > 0 ? Number(sumProofs(unspent)) : 0
          // Self-heal the store: drop proofs the mint reports spent so the
          // optimistic estimate stays honest for the next mint-down window.
          // Quiet write — this load already owns the UI update.
          const next = loadStore(pubkey)
          next[mint] = serializeProofs(unspent)
          saveStoreQuiet(pubkey, next)
          return { mint, amount, ok: true }
        } catch {
          // mint unreachable — keep the optimistic local estimate, mark stale
          return { mint, amount: sumStoredAmounts(raw), ok: false }
        }
      }),
    )

    const merged = mergeMintBalances(localByMint, results)
    setByMint(merged.byMint)
    setTotal(merged.total)
    setStale(merged.stale)
    setRefreshing(false)
  }, [pubkey])

  useEffect(() => {
    load()
    // Refresh whenever the wallet store mutates (bid/refund/receive/claim) —
    // this keeps the header balance in sync without polling the mint.
    const onChanged = () => {
      void load()
    }
    // Coming back to the tab is a cheap freshness signal too: another tab may
    // have placed a bid or recovered a refund while this one was hidden.
    const onVisibility = () => {
      if (!document.hidden) void load()
    }
    window.addEventListener(WALLET_CHANGED_EVENT, onChanged)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener(WALLET_CHANGED_EVENT, onChanged)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [load])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
  }, [load])

  return { total, byMint, loading, refreshing, refresh, stale }
}
