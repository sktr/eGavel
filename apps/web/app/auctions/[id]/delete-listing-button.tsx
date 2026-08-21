"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useIdentity } from "../../../lib/identity"
import { signSecretHex } from "../../../lib/claim"
import { bytesToHex } from "../../../lib/hex"
import { apiUrl } from "../../../lib/api"
import {
  buildListingDeletionEvent,
  deleteBlossomImages,
  publishListing,
} from "../../../lib/nostr-listing"

/**
 * Seller-only "Delete listing" button for bid-less auctions. Shown next to
 * the auction meta row (state / bid count) when the current identity is the
 * seller and no bids exist yet.
 */
export function DeleteListingButton({
  auctionId,
  sellerPubkey,
  state,
  bidsCount,
  images,
}: {
  auctionId: string
  sellerPubkey: string
  state: string
  bidsCount: number
  images?: string[] | null
}) {
  const { identity } = useIdentity()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canDelete =
    identity !== null &&
    identity.pubkey === sellerPubkey &&
    state === "ACTIVE" &&
    bidsCount === 0

  if (!canDelete) return null

  async function handleDelete() {
    setError(null)
    if (!identity) return
    if (!window.confirm("Delete this listing? It has no bids yet, so no funds are affected.")) return
    setBusy(true)
    try {
      // Auth = Schnorr signature over `delete:<auctionId>` (the pubkey alone
      // is public listing data — the server requires key-ownership proof).
      const sellerSig = signSecretHex(`delete:${auctionId}`, bytesToHex(identity.secretKey))
      const res = await fetch(
        apiUrl(`/auctions/${auctionId}?seller_pubkey=${identity.pubkey}&seller_sig=${sellerSig}`),
        { method: "DELETE" },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({})) as { error?: string })
        throw new Error(body.error ?? "delete failed")
      }
      // DB deletion succeeded — now clean up the Nostr mirror + Blossom blobs.
      // Both are fire-and-forget: failures must not block navigation.
      void (async () => {
        try {
          const nostr = (
            window as unknown as {
              nostr?: { signEvent: (e: unknown) => Promise<unknown> }
            }
          ).nostr
          if (!nostr?.signEvent) return
          try {
            const del = buildListingDeletionEvent({ sellerNostrPubkey: identity.pubkey, auctionId })
            // The deletion event is signed by the trading key's linked Nostr
            // key via NIP-07; identity.pubkey here is the trading pubkey, so
            // ask the extension to sign directly (author = Nostr key).
            await publishListing(del, nostr as unknown as { signEvent: (t: unknown) => Promise<unknown> })
          } catch (e) {
            console.error("[Nostr] deletion publish failed", e)
          }
          if (images && images.length > 0) {
            try {
              await deleteBlossomImages(images, nostr as unknown as { signEvent: (t: unknown) => Promise<unknown> })
            } catch (e) {
              console.error("[Nostr] blossom delete failed", e)
            }
          }
        } catch {
          // cleanup is best-effort
        }
      })()
      router.push("/")
      router.refresh()
    } catch (err) {
      setError(String(err))
      setBusy(false)
    }
  }

  return (
    <>
      {error && <span style={{ fontSize: 12, color: "var(--red)" }}>{error}</span>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--surface)",
          color: "var(--red)",
          padding: "6px 14px",
          fontSize: 12,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          lineHeight: 1.4,
          opacity: busy ? 0.5 : 1,
        }}
      >
        Delete listing
      </button>
    </>
  )
}
