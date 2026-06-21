"use client"

import { useCallback, useEffect, useState } from "react"
import { hexToBytes } from "nostr-tools/utils"
import {
  createAccount,
  loadAccount,
  saveAccount,
  needsBackup,
  markBackupSeen,
  parseRestoreInput,
  clearAccount,
  type Account,
} from "./key-store"

const LOGGED_OUT_KEY = "cashu-auction-logged-out"

export interface Identity {
  pubkey: string
  secretKey: Uint8Array
  /** Recovery phrase (12 words). null for legacy raw-key accounts. */
  recoveryPhrase: string | null
}

function toIdentity(account: Account): Identity {
  return {
    pubkey: account.pubkey,
    secretKey: hexToBytes(account.secretKeyHex),
    recoveryPhrase: account.words,
  }
}

export function useIdentity() {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  // true while a freshly created account hasn't had its phrase acknowledged
  const [showBackupPrompt, setShowBackupPrompt] = useState(false)

  // Load or create the account (synchronous, browser-local only)
  const ensureAccount = useCallback((): Identity | null => {
    if (typeof window === "undefined") return null
    try {
      let account = loadAccount()
      if (!account) {
        account = createAccount()
        saveAccount(account)
        setShowBackupPrompt(needsBackup(account))
      }
      return toIdentity(account)
    } catch {
      return null // storage unavailable — anonymous
    }
  }, [])

  // Init on mount
  useEffect(() => {
    if (typeof window === "undefined") {
      setIsLoaded(true)
      return
    }
    try {
      // If the user logged out explicitly, stay anonymous until login() is called.
      if (localStorage.getItem(LOGGED_OUT_KEY)) {
        setIsLoaded(true)
        return
      }
    } catch {
      // storage unavailable — proceed anonymous
    }
    setIdentity(ensureAccount())
    setIsLoaded(true)
  }, [ensureAccount])

  // Explicit login — useful for the "Connect" button
  const login = useCallback(() => {
    try {
      localStorage.removeItem(LOGGED_OUT_KEY)
    } catch {
      // storage unavailable — ignore
    }
    const acct = ensureAccount()
    if (acct) setIdentity(acct)
    setIsLoaded(true)
  }, [ensureAccount])

  // Logout — browse anonymously until the next login. The key itself is kept
  // (it IS the account): clearing it would destroy access to locked bids.
  const logout = useCallback(() => {
    try {
      localStorage.setItem(LOGGED_OUT_KEY, "1")
    } catch {
      // storage unavailable — ignore
    }
    setIdentity(null)
  }, [])

  // Phrase acknowledged (saved via the first-visit dialog or backup section)
  const acknowledgeBackup = useCallback(() => {
    markBackupSeen()
    setShowBackupPrompt(false)
  }, [])

  // Restore the account from a phrase or hex secret key (replaces the current key)
  const restore = useCallback((input: string): { ok: boolean; error?: string } => {
    try {
      const { account } = parseRestoreInput(input)
      saveAccount(account)
      markBackupSeen() // a restorer already holds the phrase
      setIdentity(toIdentity(account))
      setShowBackupPrompt(false)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, [])

  // Delete the account entirely (explicit action only)
  const deleteAccount = useCallback(() => {
    clearAccount()
    setIdentity(null)
    setShowBackupPrompt(false)
    try {
      localStorage.setItem(LOGGED_OUT_KEY, "1")
    } catch {
      // ignore
    }
  }, [])

  return {
    identity,
    isLoaded,
    showBackupPrompt,
    login,
    logout,
    acknowledgeBackup,
    restore,
    deleteAccount,
  }
}
