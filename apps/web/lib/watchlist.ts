"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const STORAGE_KEY = "egavel-watchlist"

export function loadWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveWatchlist(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // storage unavailable — ignore
  }
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/** Drop the given ids from the list (e.g. auctions the seller deleted). */
export function removeIds(ids: string[], toRemove: string[]): string[] {
  const gone = new Set(toRemove)
  return ids.filter((x) => !gone.has(x))
}

export function useWatchlist() {
  const [ids, setIds] = useState<string[]>([])
  const loadedRef = useRef(false)

  // Hydration-safe: server and first client render both show [], then we load
  // real data after mount so SSR HTML matches.
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true
      setIds(loadWatchlist())
    }
  }, [])

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = toggleId(prev, id)
      saveWatchlist(next)
      return next
    })
  }, [])

  const remove = useCallback((toRemove: string[]) => {
    setIds((prev) => {
      const next = removeIds(prev, toRemove)
      if (next.length === prev.length) return prev
      saveWatchlist(next)
      return next
    })
  }, [])

  return { ids, watching: (id: string) => ids.includes(id), toggle, remove }
}
