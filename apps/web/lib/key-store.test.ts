import { describe, it, expect, beforeEach } from "vitest"
import {
  createAccount,
  deriveAccountFromWords,
  deriveAccountFromHex,
  loadAccount,
  saveAccount,
  needsBackup,
  markBackupSeen,
  validateMnemonicInput,
  parseRestoreInput,
  clearAccount,
} from "./key-store"
import { generateMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"

const BACKUP_SEEN_KEY = "egavel-backup-seen"

describe("key-store (BIP-39 recovery phrase)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("creates an account with a 12-word mnemonic and a valid keypair", () => {
    const acct = createAccount()
    expect(acct.words).toBeTruthy()
    expect(acct.words!.split(" ")).toHaveLength(12)
    expect(validateMnemonicInput(acct.words!)).toBe(true)
    expect(acct.secretKeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(acct.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it("restores the exact same keypair from the mnemonic", () => {
    const acct = createAccount()
    const restored = deriveAccountFromWords(acct.words!)
    expect(restored.secretKeyHex).toBe(acct.secretKeyHex)
    expect(restored.pubkey).toBe(acct.pubkey)
  })

  it("different mnemonics derive different keys", () => {
    const a = createAccount()
    const b = createAccount()
    expect(a.pubkey).not.toBe(b.pubkey)
  })

  it("rejects invalid mnemonics", () => {
    expect(validateMnemonicInput("apple banana cherry not-words")).toBe(false)
    expect(validateMnemonicInput("")).toBe(false)
  })

  it("accepts 24-word mnemonics", () => {
    const words = generateMnemonic(wordlist, 256)
    expect(words.split(" ")).toHaveLength(24)
    expect(validateMnemonicInput(words)).toBe(true)
    const fromWords = parseRestoreInput(words)
    expect(fromWords.kind).toBe("words")
  })

  it("accepts 12-word mnemonics for restore", () => {
    const acct = createAccount()
    const fromWords = parseRestoreInput(acct.words!)
    expect(fromWords.kind).toBe("words")
    expect(() => parseRestoreInput("garbage input")).toThrow()
  })

  it("rejects a 64-hex secret key on restore", () => {
    const acct = createAccount()
    expect(() => parseRestoreInput(acct.secretKeyHex)).toThrow()
    expect(() => parseRestoreInput("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")).toThrow()
  })

  it("save/load round-trips through localStorage, preserving words", () => {
    const acct = createAccount()
    saveAccount(acct)
    const loaded = loadAccount()
    expect(loaded).not.toBeNull()
    expect(loaded!.secretKeyHex).toBe(acct.secretKeyHex)
    expect(loaded!.words).toBe(acct.words)
  })

  it("loads a legacy account (raw secret key, no words)", () => {
    localStorage.setItem("egavel-identity", JSON.stringify({ secretKey: "ab".repeat(32) }))
    const loaded = loadAccount()
    expect(loaded).not.toBeNull()
    expect(loaded!.words).toBeNull()
    expect(loaded!.secretKeyHex).toBe("ab".repeat(32))
  })

  it("needsBackup is true for fresh mnemonic accounts until seen", () => {
    const acct = createAccount()
    expect(needsBackup(acct)).toBe(true)
    markBackupSeen()
    expect(needsBackup(acct)).toBe(false)
  })

  it("needsBackup is false for legacy accounts without a mnemonic", () => {
    const acct = deriveAccountFromHex("ab".repeat(32))
    expect(needsBackup(acct)).toBe(false)
  })

  it("clearAccount removes the stored identity and backup flag", () => {
    const acct = createAccount()
    saveAccount(acct)
    markBackupSeen()
    clearAccount()
    expect(loadAccount()).toBeNull()
    expect(localStorage.getItem(BACKUP_SEEN_KEY)).toBeNull()
  })
})
