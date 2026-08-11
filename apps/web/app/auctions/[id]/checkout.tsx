"use client"

import { useState } from "react"
import { useIdentity } from "../../../lib/identity"
import { signSecretHex } from "../../../lib/claim"
import { bytesToHex } from "nostr-tools/utils"

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "")

export function Checkout({ auctionId, winnerNpub }: { auctionId: string; winnerNpub: string }) {
  const { identity } = useIdentity()
  const [address, setAddress] = useState("")
  const [note, setNote] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // winnerNpub is stored as the bidder's HEX pubkey (process-bid.ts stores
  // bidder_pubkey hex into bidder_npub) — compare hex-vs-hex, not npub.
  const isWinner =
    identity && winnerNpub && identity.pubkey === winnerNpub

  if (!isWinner) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    if (!identity) return

    // Auth = Schnorr signature over the payload string (same scheme as P2PK).
    // The winner signs with their key; the server verifies it matches the winner key.
    try {
      if (!identity.secretKey) {
        setError("signing unavailable")
        return
      }
      const noteOrNull = note || null
      const content = JSON.stringify({ auction_id: auctionId, address, note: noteOrNull })
      const sig = signSecretHex(content, bytesToHex(identity.secretKey))

      const res = await fetch(`${API_BASE}/api/auctions/${auctionId}/shipping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auction_id: auctionId, address, note: noteOrNull, pubkey: identity.pubkey, sig }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "failed to submit shipping info")
      }
      setAddress("")
      setNote("")
      setStatus("Shipping address submitted to the seller.")
    } catch (err) {
      setError(`failed to submit: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginTop: 24,
      }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>You won — provide shipping details</h2>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Shipping address"
          required
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            fontSize: 14,
            fontFamily: "inherit",
            background: "var(--surface)",
            color: "var(--fg)",
          }}
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note to the seller (optional)"
          rows={2}
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            fontSize: 14,
            fontFamily: "inherit",
            background: "var(--surface)",
            color: "var(--fg)",
            resize: "vertical",
          }}
        />
        <button
          type="submit"
          style={{
            alignSelf: "flex-start",
            border: "none",
            borderRadius: "var(--radius)",
            background: "var(--accent)",
            color: "#fff",
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Submit
        </button>
        {error && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}
        {status && <p style={{ color: "var(--accent2)", fontSize: 13, margin: 0 }}>{status}</p>}
      </form>
    </div>
  )
}
