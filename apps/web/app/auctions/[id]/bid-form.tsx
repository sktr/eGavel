"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { nip19, nip59, generateSecretKey } from "nostr-tools"
import { bytesToHex } from "nostr-tools/utils"
import { SimplePool } from "nostr-tools/pool"
import { MintQuoteState, createP2PKsecret, Amount } from "@cashu/cashu-ts"
import type { Proof } from "@cashu/cashu-ts"
import type { Auction } from "@cashu-auction/shared"
import { useWallet } from "../../../lib/wallet"
import { useIdentity } from "../../../lib/identity"

const TEST_MINT_URL = "test://local"

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"]
const DEFAULT_MINT = "https://testnut.cashu.space"

export function BidForm({
  auction,
  serverNpub: serverNpubProp,
  buyNowPrice,
}: {
  auction: Auction
  serverNpub: string
  buyNowPrice?: number | null
}) {
  const router = useRouter()
  const { identity, isLoaded } = useIdentity()
  const [serverPubkeyHex, setServerPubkeyHex] = useState<string | null>(null)

  // Fetch server pubkey from health API or fall back to env prop
  useEffect(() => {
    if (serverNpubProp) {
      try {
        const decoded = nip19.decode(serverNpubProp)
        setServerPubkeyHex(bytesToHex(decoded.data as Uint8Array))
        return
      } catch { /* fall through to API */ }
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
    fetch(`${apiBase}/health`)
      .then((r) => r.json())
      .then((data) => {
        if (data.pubkey) setServerPubkeyHex(data.pubkey)
      })
      .catch(() => { /* server might not be running */ })
  }, [serverNpubProp])

  // Wallet — default to the mint the seller specified (spec §7.4 / review G4)
  const [mintUrl, setMintUrl] = useState(auction.mint_url || DEFAULT_MINT)
  const wallet = useWallet(mintUrl)

  // Form state
  const [amount, setAmount] = useState("")
  const [tokenInput, setTokenInput] = useState("")
  const [receiveMessage, setReceiveMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testMode, setTestMode] = useState(false)

  // ── Faucet / mint state ─────────────────────────────
  const [mintAmount, setMintAmount] = useState("100")
  const [mintQuote, setMintQuote] = useState<{
    quote: string
    request: string
    amount: number
    state: string
  } | null>(null)
  const [mintStep, setMintStep] = useState<
    "idle" | "quoting" | "awaiting" | "claiming" | "done"
  >("idle")
  const [mintError, setMintError] = useState<string | null>(null)
  const [mintMessage, setMintMessage] = useState<string | null>(null)

  const handleRequestMint = useCallback(async () => {
    setMintError(null)
    setMintQuote(null)
    setMintStep("quoting")
    const amt = parseInt(mintAmount, 10)
    if (isNaN(amt) || amt <= 0) {
      setMintError("enter a valid amount")
      setMintStep("idle")
      return
    }
    try {
      const quote = await wallet.requestMint(amt)
      setMintQuote({
        quote: quote.quote,
        request: quote.request,
        amount: Number(quote.amount),
        state: quote.state,
      })
      setMintStep("awaiting")
      setMintMessage(
        `Invoice created — pay it with a testnet Lightning wallet, then click "Check payment".`,
      )
    } catch (err) {
      setMintError(`mint request failed: ${err instanceof Error ? err.message : String(err)}`)
      setMintStep("idle")
    }
  }, [mintAmount, wallet])

  const handleCheckPayment = useCallback(async () => {
    if (!mintQuote) return
    setMintError(null)
    setMintMessage("checking payment...")
    try {
      const checked = await wallet.checkMintQuote(mintQuote.quote)
      if (checked.state !== MintQuoteState.PAID) {
        setMintMessage(`Invoice status: ${checked.state}. Pay the invoice first, then check again.`)
        return
      }
      // Paid — mint the proofs
      setMintStep("claiming")
      setMintMessage("payment received! minting tokens...")
      await wallet.claimMint(mintQuote.amount, checked)
      setMintStep("done")
      setMintMessage(`Minted ${mintQuote.amount} sats successfully!`)
    } catch (err) {
      setMintError(`payment check failed: ${err instanceof Error ? err.message : String(err)}`)
      setMintStep("awaiting")
    }
  }, [mintQuote, wallet])

  const handleCopyInvoice = useCallback(() => {
    if (mintQuote?.request) {
      navigator.clipboard.writeText(mintQuote.request)
      setMintMessage("invoice copied!")
    }
  }, [mintQuote])

  // ── Receive tokens ───────────────────────────────────
  async function handleReceive() {
    if (!tokenInput.trim()) return
    setError(null)
    setReceiveMessage(null)
    try {
      const result = await wallet.receive(tokenInput.trim())
      setTokenInput("")
      setReceiveMessage(`Received ${result.amount} sats at ${result.mint}`)
      // If the token's mint differs, update the field
      if (result.mint !== mintUrl) {
        setMintUrl(result.mint)
      }
    } catch (err) {
      setError(`receive failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Place bid ────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!identity) {
      setError("identity not loaded")
      return
    }

    const bidAmount =
      buyNowPrice !== undefined && buyNowPrice !== null
        ? buyNowPrice
        : parseInt(amount, 10)
    if (buyNowPrice === undefined || buyNowPrice === null) {
      if (isNaN(bidAmount) || bidAmount <= 0) {
        setError("amount must be a positive number")
        return
      }
    }

    if (!testMode) {
      if (!wallet.ready) {
        setError("wallet not ready yet")
        return
      }
      if (wallet.balance < bidAmount) {
        setError(
          `insufficient balance: ${wallet.balance} sats available, need ${bidAmount} sats`,
        )
        return
      }
    }

    if (!serverPubkeyHex) {
      setError("server pubkey not available — is the server running?")
      return
    }

    setSubmitting(true)

    try {
      const locktime = Math.floor(
        (auction.end_time + 24 * 60 * 60 * 1000) / 1000,
      )

      // 1. Create proof (real P2PK or test dummy)
      let proof: Proof
      let mintUrlForBid: string

      if (testMode) {
        const secret = createP2PKsecret(auction.seller_pubkey, [
          ["pubkeys", serverPubkeyHex],
          ["n_sigs", "2"],
          ["locktime", String(locktime)],
          ["refund", identity.pubkey],
        ])
        proof = {
          id: "test-keyset",
          amount: Amount.from(bidAmount),
          secret,
          C: "test-signature",
        }
        mintUrlForBid = TEST_MINT_URL
      } else {
        const { proof: walletProof } = await wallet.sendP2PK(bidAmount, {
          pubkey: [auction.seller_pubkey, serverPubkeyHex],
          requiredSignatures: 2,
          locktime,
          refundKeys: [identity.pubkey],
        })
        proof = walletProof
        mintUrlForBid = mintUrl
      }

      // 2. Build the server payload
      const payload = JSON.stringify({
        proof: {
          id: proof.id,
          amount: Number(proof.amount),
          secret: proof.secret,
          C: proof.C,
        },
        mint_url: mintUrlForBid,
        auction_id: auction.id,
        amount: bidAmount,
        bidder_pubkey: identity.pubkey,
      })

      // 3. Send bid
      if (testMode) {
        // Test mode: send directly via HTTP (no Nostr relays needed)
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
        const res = await fetch(`${apiBase}/api/bids`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error ?? "bid rejected")
        }
      } else {
        // Real mode: send via NIP-59 gift wrap to Nostr relays
        // Use the identity key if available (fallback); otherwise use ephemeral
        // key for the gift-wrap encryption (authenticated by bidder_pubkey inside)
        const wrapKey = identity.secretKey ?? generateSecretKey()
        const pool = new SimplePool()
        const wrapEvent = nip59.wrapEvent(
          { kind: 14, tags: [], content: payload },
          wrapKey,
          serverPubkeyHex,
        )
        await Promise.any(pool.publish(DEFAULT_RELAYS, wrapEvent))
      }

      setSuccess("bid submitted!")
      setTimeout(() => router.refresh(), 2000)
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ───────────────────────────────────────────
  const isOpen = auction.state === "ACTIVE" || auction.state === "EXTENDED"
  if (!isOpen) return null

  return (
    <form onSubmit={handleSubmit}>
      {/* Identity info */}
      {!isLoaded ? (
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          Loading…
        </p>
      ) : identity?.npub ? (
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, wordBreak: "break-all" }}>
          Key: <code style={{ fontSize: 11 }}>{identity.npub}</code>
        </p>
      ) : null}

      {/* Inline bid row: input + submit */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <input
          id="amount"
          type="number"
          min={auction.start_price}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          placeholder="Bid amount (sats)"
          style={{
            flex: 1,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            fontSize: 15,
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            background: "var(--surface)",
            color: "var(--fg)",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)"
            e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)"
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)"
            e.currentTarget.style.boxShadow = "none"
          }}
        />
        <button
          type="submit"
          disabled={submitting || (!testMode && !wallet.ready)}
          style={{
            border: "none",
            borderRadius: "var(--radius)",
            background: "var(--accent)",
            color: "#fff",
            padding: "10px 24px",
            fontSize: 15,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: submitting || (!testMode && !wallet.ready) ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            opacity: submitting || (!testMode && !wallet.ready) ? 0.5 : 1,
            lineHeight: 1.4,
          }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled) e.currentTarget.style.filter = "brightness(0.92)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = "none"
          }}
        >
          {submitting
            ? "Submitting…"
            : !testMode && !wallet.ready
              ? "Checking wallet…"
              : "Place Bid"}
        </button>
      </div>

      {/* Error / Success */}
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13, margin: "4px 0 8px" }}>{error}</p>
      )}
      {success && (
        <p style={{ color: "var(--accent2)", fontSize: 13, margin: "4px 0 8px" }}>{success}</p>
      )}

      {/* Advanced settings (collapsible) */}
      <details style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
        <summary style={{ cursor: "pointer", padding: "4px 0", fontWeight: 500 }}>
          Advanced Settings
        </summary>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Test mode toggle */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              userSelect: "none",
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }}
            />
            <span>Test Mode</span>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>(no real tokens needed)</span>
          </label>

          {/* Wallet status (non-test mode only) */}
          {!testMode && (
            <div
              style={{
                background: "var(--bg)",
                borderRadius: "var(--radius)",
                padding: "8px 12px",
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ color: "var(--muted)" }}>Wallet</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {wallet.loading ? (
                  <span style={{ color: "var(--muted)" }}>Loading…</span>
                ) : wallet.error ? (
                  <span style={{ color: "var(--red)", fontSize: 12 }}>{wallet.error}</span>
                ) : (
                  <>
                    <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>{wallet.balance} sats</span>
                    {wallet.ready && (
                      <button
                        type="button"
                        onClick={wallet.refresh}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          background: "var(--surface)",
                          color: "var(--fg)",
                          padding: "4px 10px",
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          lineHeight: 1.4,
                        }}
                      >
                        Refresh
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          )}

          {/* Mint URL (non-test mode) */}
          {!testMode && (
            <div>
              <label htmlFor="mint" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: "block" }}>
                Mint URL
              </label>
              <input
                id="mint"
                type="url"
                value={mintUrl}
                onChange={(e) => setMintUrl(e.target.value)}
                required
                style={{
                  width: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: "var(--font-mono)",
                  background: "var(--surface)",
                  color: "var(--fg)",
                  outline: "none",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)"
                  e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)"
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)"
                  e.currentTarget.style.boxShadow = "none"
                }}
              />
            </div>
          )}

          {/* Receive tokens (non-test mode) */}
          {!testMode && (
            <details style={{ fontSize: 13 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", padding: "4px 0" }}>
                Receive Tokens
              </summary>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  rows={2}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="cashuA… or paste token JSON"
                  style={{
                    width: "100%",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    padding: "8px 12px",
                    fontSize: 13,
                    fontFamily: "var(--font-mono)",
                    background: "var(--surface)",
                    color: "var(--fg)",
                    outline: "none",
                    resize: "vertical",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)"
                    e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)"
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)"
                    e.currentTarget.style.boxShadow = "none"
                  }}
                />
                {receiveMessage && (
                  <p style={{ color: "var(--accent2)", fontSize: 12, margin: 0 }}>{receiveMessage}</p>
                )}
                <button
                  type="button"
                  onClick={handleReceive}
                  disabled={!tokenInput.trim() || wallet.loading}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    background: "var(--surface)",
                    color: "var(--fg)",
                    padding: "6px 14px",
                    fontSize: 13,
                    cursor: !tokenInput.trim() || wallet.loading ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    opacity: !tokenInput.trim() || wallet.loading ? 0.5 : 1,
                    alignSelf: "flex-start",
                    lineHeight: 1.4,
                  }}
                >
                  Receive
                </button>
              </div>
            </details>
          )}

          {/* Faucet (non-test mode) */}
          {!testMode && (
            <details style={{ fontSize: 13 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", padding: "4px 0" }}>
                Request Test Tokens
              </summary>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
                  Request from <code style={{ fontSize: 11 }}>{mintUrl}</code>
                </p>

                {mintStep === "idle" || mintStep === "quoting" ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="number"
                      min={1}
                      value={mintAmount}
                      onChange={(e) => setMintAmount(e.target.value)}
                      style={{
                        width: 100,
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        padding: "6px 10px",
                        fontSize: 13,
                        fontFamily: "var(--font-mono)",
                        background: "var(--surface)",
                        color: "var(--fg)",
                        outline: "none",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "var(--accent)"
                        e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)"
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = "var(--border)"
                        e.currentTarget.style.boxShadow = "none"
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleRequestMint}
                      disabled={mintStep === "quoting" || !wallet.ready}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        background: "var(--surface)",
                        color: "var(--fg)",
                        padding: "6px 14px",
                        fontSize: 13,
                        cursor: mintStep === "quoting" || !wallet.ready ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                        opacity: mintStep === "quoting" || !wallet.ready ? 0.5 : 1,
                        lineHeight: 1.4,
                      }}
                    >
                      {mintStep === "quoting" ? "Requesting…" : "Request Mint"}
                    </button>
                  </div>
                ) : mintStep === "awaiting" && mintQuote ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      readOnly
                      rows={2}
                      value={mintQuote.request}
                      style={{
                        width: "100%",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        padding: "8px 12px",
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        background: "var(--bg)",
                        color: "var(--fg)",
                        resize: "none",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={handleCopyInvoice}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          background: "var(--surface)",
                          color: "var(--fg)",
                          padding: "6px 14px",
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          lineHeight: 1.4,
                        }}
                      >
                        Copy Invoice
                      </button>
                      <button
                        type="button"
                        onClick={handleCheckPayment}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          background: "var(--surface)",
                          color: "var(--fg)",
                          padding: "6px 14px",
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          lineHeight: 1.4,
                        }}
                      >
                        Check Payment
                      </button>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
                      Need sats?{" "}
                      <a
                        href="https://faucet.lightning.community/"
                        target="_blank"
                        rel="noopener"
                        style={{ color: "var(--accent)" }}
                      >
                        Lightning Faucet
                      </a>
                    </p>
                  </div>
                ) : mintStep === "claiming" ? (
                  <p style={{ color: "var(--muted)", margin: 0 }}>Minting tokens…</p>
                ) : mintStep === "done" ? (
                  <p style={{ color: "var(--accent2)", margin: 0 }}>Done! Tokens minted.</p>
                ) : null}

                {mintError && <p style={{ color: "var(--red)", fontSize: 12, margin: 0 }}>{mintError}</p>}
                {mintMessage && (
                  <p style={{
                    color: mintStep === "done" ? "var(--accent2)" : "var(--muted)",
                    fontSize: 12,
                    margin: 0,
                  }}>
                    {mintMessage}
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      </details>
    </form>
  )
}
