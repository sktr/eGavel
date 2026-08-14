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

const STORAGE_KEY = "cashu-wallet-v1"

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

function loadStore(): WalletStore {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
  } catch {
    return {}
  }
}

function saveStore(data: WalletStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  // Every mutation funnels through here (receive/sendP2PK/claimMint/refresh/
  // storeProofsInWallet) — one dispatch point keeps every balance UI in sync.
  notifyWalletChanged()
}

export function useWallet(mintUrl: string) {
  const walletRef = useRef<Wallet | null>(null)
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // ── Init ──────────────────────────────────────────────
  useEffect(() => {
    if (!mintUrl) {
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

        const store = loadStore()
        const raw = store[mintUrl] ?? []

        if (raw.length > 0) {
          const stored = deserializeProofs(raw)
          const { unspent } = await wallet.groupProofsByState(stored)
          store[mintUrl] = serializeProofs(unspent)
          saveStore(store)
          setBalance(unspent.length > 0 ? Number(sumProofs(unspent)) : 0)
        } else {
          setBalance(0)
        }

        setReady(true)
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mintUrl])

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
      const store = loadStore()
      const existing = deserializeProofs(store[tokenMint] ?? [])
      store[tokenMint] = serializeProofs([...existing, ...newProofs])
      saveStore(store)

      // If this is the active mint, update balance
      if (tokenMint === mintUrl) {
        const refreshed = deserializeProofs(store[tokenMint] ?? [])
        setBalance(refreshed.length > 0 ? Number(sumProofs(refreshed)) : 0)
      }

      return { mint: tokenMint, amount: total }
    },
    [mintUrl],
  )

  // ── Send P2PK ────────────────────────────────────────
  const sendP2PK = useCallback(
    async (
      amount: number,
      options: P2PKOptions,
    ): Promise<{ proofs: Proof[]; change: Proof[] }> => {
      const wallet = walletRef.current
      if (!wallet) throw new Error("Wallet not initialized")

      const store = loadStore()
      const stored = deserializeProofs(store[mintUrl] ?? [])
      const { unspent } = await wallet.groupProofsByState(stored)

      if (unspent.length === 0) throw new Error("No unspent proofs available")

      const result = await wallet.ops
        .send(Amount.from(amount), unspent)
        .asP2PK(options)
        .includeFees(true)
        .run()

      // Store keep proofs back
      store[mintUrl] = serializeProofs(result.keep)
      saveStore(store)

      setBalance(
        result.keep.length > 0 ? Number(sumProofs(result.keep)) : 0,
      )

      if (result.send.length === 0) throw new Error("send produced no output proofs")
      return { proofs: result.send, change: result.keep }
    },
    [mintUrl],
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
    [mintUrl],
  )

  const checkMintQuote = useCallback(
    async (
      quoteId: string,
    ): Promise<MintQuoteBolt11Response> => {
      const wallet = walletRef.current
      if (!wallet) throw new Error("Wallet not initialized")
      return wallet.checkMintQuoteBolt11(quoteId)
    },
    [mintUrl],
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
      const store = loadStore()
      const existing = deserializeProofs(store[mintUrl] ?? [])
      store[mintUrl] = serializeProofs([...existing, ...proofs])
      saveStore(store)

      const refreshed = deserializeProofs(store[mintUrl] ?? [])
      setBalance(refreshed.length > 0 ? Number(sumProofs(refreshed)) : 0)

      return proofs
    },
    [mintUrl],
  )

  // ── Refresh ──────────────────────────────────────────
  const refresh = useCallback(async () => {
    const wallet = walletRef.current
    if (!wallet) return

    const store = loadStore()
    const stored = deserializeProofs(store[mintUrl] ?? [])
    const { unspent } = await wallet.groupProofsByState(stored)
    store[mintUrl] = serializeProofs(unspent)
    saveStore(store)
    setBalance(unspent.length > 0 ? Number(sumProofs(unspent)) : 0)
  }, [mintUrl])

  return { balance, loading, error, ready, receive, sendP2PK, refresh, requestMint, checkMintQuote, claimMint }
}

export function storeProofsInWallet(proofs: Proof[], mintUrl: string) {
  const store = loadStore()
  const existing = deserializeProofs(store[mintUrl] ?? [])
  store[mintUrl] = serializeProofs([...existing, ...proofs])
  saveStore(store)
}

// ── Total balance across all mints in the local wallet store ──────────────
export interface MintBalance {
  mint: string
  amount: number
}

export function useTotalBalance() {
  const [total, setTotal] = useState(0)
  const [byMint, setByMint] = useState<MintBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const store = loadStore()
    const entries = Object.entries(store).filter(([, proofs]) => proofs.length > 0)
    if (entries.length === 0) {
      setTotal(0)
      setByMint([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    const results = await Promise.all(
      entries.map(async ([mint, raw]): Promise<MintBalance> => {
        try {
          const wallet = buildWallet(mint)
          await wallet.loadMint()
          const stored = deserializeProofs(raw)
          const { unspent } = await wallet.groupProofsByState(stored)
          const amount = unspent.length > 0 ? Number(sumProofs(unspent)) : 0
          return { mint, amount }
        } catch {
          // mint unreachable — best effort: sum the stored amounts as-is
          let amount = 0
          for (const s of raw) {
            try {
              amount += Number(JSON.parse(s).amount ?? 0)
            } catch {
              // unparseable entry — skip
            }
          }
          return { mint, amount }
        }
      }),
    )

    const valid = results.filter((r) => r.amount > 0)
    setByMint(valid)
    setTotal(valid.reduce((acc, r) => acc + r.amount, 0))
    setLoading(false)
    setRefreshing(false)
  }, [])

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

  return { total, byMint, loading, refreshing, refresh }
}
