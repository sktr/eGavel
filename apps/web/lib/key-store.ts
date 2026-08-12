"use client"

/**
 * An account is a keypair derived from a 12-word BIP-39 recovery phrase — the
 * standard Cashu wallet UX (seed generation → backup → restore).
 * Legacy localStorage keys (raw secretKey) still load (backward compatible).
 */
import { generateSeedWords, privateKeyFromSeedWords, validateWords } from "nostr-tools/nip06"
import { getPublicKey } from "nostr-tools"
import { bytesToHex, hexToBytes } from "nostr-tools/utils"

export interface Account {
  secretKeyHex: string
  pubkey: string
  /** Recovery phrase. null for legacy keys (raw hex). */
  words: string | null
}

const STORAGE_KEY = "cashu-auction-identity"
const BACKUP_SEEN_KEY = "cashu-auction-backup-seen"

interface StoredIdentity {
  secretKey: string
  words?: string
}

function accountFromSecretKey(sk: Uint8Array, words: string | null = null): Account {
  const secretKeyHex = bytesToHex(sk)
  const pubkey = getPublicKey(sk)
  return { secretKeyHex, pubkey, words }
}

/** New account: generate a 12-word phrase and derive the key. */
export function createAccount(): Account {
  const words = generateSeedWords()
  return accountFromSecretKey(privateKeyFromSeedWords(words), words)
}

/** Restore the key from a phrase (derivation is deterministic). */
export function deriveAccountFromWords(words: string): Account {
  return accountFromSecretKey(privateKeyFromSeedWords(words), words)
}

/** Build an account from a raw secret key (hex) — legacy, no phrase. */
export function deriveAccountFromHex(hex: string): Account {
  return accountFromSecretKey(hexToBytes(hex))
}

export function validateMnemonicInput(words: string): boolean {
  return words.trim().split(/\s+/).length === 12 && validateWords(words.trim())
}

export type RestoreInput =
  | { kind: "words"; account: Account }
  | { kind: "hex"; account: Account }

/** Interpret a restore input (12-word phrase or 64-hex secret key). */
export function parseRestoreInput(input: string): RestoreInput {
  const trimmed = input.trim()
  if (validateMnemonicInput(trimmed)) {
    return { kind: "words", account: deriveAccountFromWords(trimmed) }
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { kind: "hex", account: deriveAccountFromHex(trimmed.toLowerCase()) }
  }
  throw new Error("INVALID_RECOVERY_INPUT")
}

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredIdentity
    if (!stored.secretKey) return null
    return accountFromSecretKey(hexToBytes(stored.secretKey), stored.words ?? null)
  } catch {
    return null
  }
}

export function saveAccount(account: Account) {
  const stored: StoredIdentity = { secretKey: account.secretKeyHex }
  if (account.words) stored.words = account.words
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

export function needsBackup(account: Account): boolean {
  if (!account.words) return false // legacy raw key: nothing to show
  try {
    return localStorage.getItem(BACKUP_SEEN_KEY) !== "1"
  } catch {
    return false
  }
}

export function markBackupSeen() {
  try {
    localStorage.setItem(BACKUP_SEEN_KEY, "1")
  } catch {
    // storage unavailable — ignore
  }
}

export function clearAccount() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(BACKUP_SEEN_KEY)
  } catch {
    // storage unavailable — ignore
  }
}
