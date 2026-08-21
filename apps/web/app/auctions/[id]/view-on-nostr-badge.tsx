"use client"

import { useState } from "react"
import { buildListingEvent, publishListing } from "../../../lib/nostr-listing"

type RepublishAuction = {
  id: string
  item: string
  description: string
  start_price: number
  reserve_price?: number | null
  buy_now_price?: number | null
  end_time: number
  category?: string | null
  images?: string[] | null
  image?: string | null
}

export function ViewOnNostrBadge({ naddr, auction }: { naddr: string; auction?: RepublishAuction }) {
  const [copied, setCopied] = useState(false)
  const [republishing, setRepublishing] = useState(false)
  const [republishMsg, setRepublishMsg] = useState<string | null>(null)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(naddr)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  const onRepublish = async () => {
    if (!auction) return
    const nostr = (
      window as unknown as {
        nostr?: { getPublicKey: () => Promise<string>; signEvent: (e: unknown) => Promise<unknown> }
      }
    ).nostr
    if (!nostr?.signEvent || !nostr?.getPublicKey) {
      setRepublishMsg("Connect NIP-07 extension")
      setTimeout(() => setRepublishMsg(null), 2500)
      return
    }
    setRepublishing(true)
    setRepublishMsg(null)
    try {
      const pubkey = await nostr.getPublicKey()
      const imageUrls = (auction.images && auction.images.length > 0 ? auction.images : auction.image ? [auction.image] : []) as string[]
      const event = buildListingEvent({
        auctionId: auction.id,
        item: auction.item,
        description: auction.description,
        startPrice: auction.start_price,
        reservePrice: auction.reserve_price ?? undefined,
        buyNowPrice: auction.buy_now_price ?? undefined,
        endTime: auction.end_time,
        category: auction.category ?? undefined,
        imageUrls,
        sellerNostrPubkey: pubkey,
      })
      await publishListing(event, nostr as unknown as { signEvent: (t: unknown) => Promise<unknown> })
      console.log("[Nostr] republished 30402", event)
      setRepublishMsg("Published")
    } catch (e) {
      console.error("[Nostr] republish failed", e)
      setRepublishMsg("Failed")
    } finally {
      setRepublishing(false)
      setTimeout(() => setRepublishMsg(null), 2500)
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
      <a
        href={`https://nostr.at/${naddr}`}
        target="_blank"
        rel="noopener"
        style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}
      >
        View on Nostr
      </a>
      <button
        onClick={onCopy}
        style={{
          fontSize: 12,
          color: "var(--muted)",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "2px 6px",
          cursor: "pointer",
        }}
      >
        {copied ? "Copied" : "Copy naddr"}
      </button>
      {auction && (
        <button
          onClick={onRepublish}
          disabled={republishing}
          style={{
            fontSize: 12,
            color: "var(--muted)",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "2px 6px",
            cursor: republishing ? "not-allowed" : "pointer",
            opacity: republishing ? 0.6 : 1,
          }}
        >
          {republishing ? "Publishing…" : "Republish to Nostr"}
        </button>
      )}
      {republishMsg && <span style={{ fontSize: 12 }}>{republishMsg}</span>}
    </div>
  )
}
