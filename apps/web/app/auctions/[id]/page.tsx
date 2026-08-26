import type { Auction, PublicBid } from "@egavel/shared"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { LiveBids } from "./live-bids"
import { Checkout } from "./checkout"
import { SettlementInfo } from "./settlement-info"
import { ClaimPanel } from "./claim-panel"
import { Gallery } from "./gallery"
import { DeleteListingButton } from "./delete-listing-button"
import { apiUrl } from "../../../lib/api"
import { hexToNpub, nostrAtProfileUrl } from "../../../lib/npub"
import { shortHex } from "../../../lib/ident"
import { listingNaddr } from "../../../lib/nostr-listing"
import { ViewOnNostrBadge } from "./view-on-nostr-badge"

function fullNpub(pubkeyHex: string): string {
  return /^[0-9a-fA-F]{64}$/.test(pubkeyHex) ? hexToNpub(pubkeyHex) : pubkeyHex
}

function shortNpub(pubkeyHex: string): string {
  const npub = fullNpub(pubkeyHex)
  return npub.length > 20 ? npub.slice(0, 12) + "…" + npub.slice(-8) : npub
}

/** Seller display: a linked seller's npub links to their Nostr profile on
 * nostr.at; an unlinked seller shows the short trading-key hex. */
function SellerIdentity({ auction }: { auction: Auction }) {
  const verified = auction.seller_nostr_pubkey
  if (verified) {
    return (
      <a
        href={nostrAtProfileUrl(verified)}
        target="_blank"
        rel="noopener noreferrer"
        title={verified}
        style={{ color: "inherit", textDecoration: "underline dotted" }}
      >
        {shortNpub(verified)}
      </a>
    )
  }
  return <span title={auction.seller_pubkey}>{shortHex(auction.seller_pubkey)}</span>
}

async function fetchAuction(id: string): Promise<Auction | null> {
  const res = await fetch(
    apiUrl(`/auctions/${id}`, process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL),
    { cache: "no-store" },
  )
  if (!res.ok) return null
  return res.json() as Promise<Auction>
}

async function fetchBids(id: string): Promise<PublicBid[]> {
  const res = await fetch(
    apiUrl(`/auctions/${id}/bids`, process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL),
    { cache: "no-store" },
  )
  if (!res.ok) return []
  return res.json() as Promise<PublicBid[]>
}

// Site origin used for canonical/OGP URLs. Defaults to localhost in dev; set
// NEXT_PUBLIC_SITE_URL in production (Vercel project `egavel`).
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "")

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const auction = await fetchAuction(id)
  if (!auction) return { title: "Auction not found — eGavel" }

  const image = auction.images?.[0]
  // SNS crawlers cannot fetch data: URLs — only advertise absolute http(s)
  // images in og:image so the card actually renders.
  const ogImage = image && /^https?:\/\//.test(image) ? image : undefined
  const openGraph: Metadata["openGraph"] = {
    title: auction.item,
    description: auction.description?.slice(0, 200) ?? undefined,
    url: `${SITE_URL}/auctions/${id}`,
    type: "website",
    ...(ogImage ? { images: [ogImage] } : {}),
  }

  return {
    title: `${auction.item} — eGavel`,
    description: auction.description?.slice(0, 200) ?? `Auction for ${auction.item}`,
    alternates: { canonical: `${SITE_URL}/auctions/${id}` },
    openGraph,
    twitter: {
      card: "summary_large_image",
      title: auction.item,
      description: auction.description?.slice(0, 200) ?? undefined,
    },
  }
}

export default async function AuctionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [auction, bids] = await Promise.all([fetchAuction(id), fetchBids(id)])
  if (!auction) notFound()

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* Breadcrumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "20px 0 4px",
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        <a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>
          Home
        </a>
        <span style={{ color: "var(--muted)", fontSize: 14, opacity: 0.6 }}>/</span>
        <span style={{ color: "var(--fg)" }}>{auction.item}</span>
      </div>

      {/* Detail grid — 2 columns */}
      <div
        className="resp-grid-2col"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 28,
          padding: "20px 0 48px",
        }}
      >
        {/* ===== LEFT COLUMN: Gallery ===== */}
        <Gallery auction={auction} />

        {/* ===== RIGHT COLUMN: Info + Bid ===== */}
        <div>
          {/* Item title + meta on one line */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(22px, 2.5vw, 28px)",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
              }}
            >
              {auction.item}
            </h1>
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "center",
                flexShrink: 0,
                color: "var(--muted)",
                fontSize: 13,
                paddingTop: 6,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span className="material-icons" style={{ fontSize: 16, verticalAlign: "text-bottom" }}>inventory_2</span> {auction.state}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span className="material-icons" style={{ fontSize: 16, verticalAlign: "text-bottom" }}>visibility</span> {bids.length} bids
              </span>
              {auction.mint_url === "" && (
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Legacy listing — bidding disabled</span>
              )}
              <DeleteListingButton
                auctionId={auction.id}
                sellerPubkey={auction.seller_pubkey}
                state={auction.state}
                bidsCount={bids.length}
                images={auction.images ?? null}
              />
            </div>
          </div>

          {/* Live bid panel + history (polls the server) */}
          <LiveBids auction={auction} bids={bids} serverNpub={""} />
        </div>

        {/* ===== BELOW THE GRID: About this lot ===== */}
        <div style={{ gridColumn: "1 / -1", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "28px 32px", marginBottom: 24 }}>
          {auction.description && (
            <>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 12 }}>About this lot</h3>
              <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.8, marginBottom: 24 }}>{auction.description}</p>
              <div style={{ height: 1, background: "var(--border)", marginBottom: 24 }} />
            </>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px 32px", fontSize: 13 }}>
            <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Start Price</div><div style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{auction.start_price.toLocaleString()} sats</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Status</div><div style={{ fontWeight: 500 }}>{auction.state}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Start Date</div><div>{new Date(auction.start_time).toLocaleString("ja-JP")}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>End Date</div><div>{new Date(auction.end_time).toLocaleString("ja-JP")}</div></div>
            {auction.category && <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Category</div><div>{auction.category}</div></div>}
            {auction.condition && <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Condition</div><div>{auction.condition}</div></div>}
            {auction.winning_amount != null && <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Winning Amount</div><div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--accent)" }}>{auction.winning_amount.toLocaleString()} sats</div></div>}
            <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Seller</div><div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}><SellerIdentity auction={auction} /></div></div>
            {auction.winner_npub && <div><div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Winner</div><div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>— <span style={{ color: "var(--muted)" }}>(anonymous)</span></div></div>}
          </div>
        </div>

        {/* Nostr Mirror — designed card */}
        {auction.seller_nostr_pubkey && (
          <div style={{ gridColumn: "1 / -1", marginBottom: 24 }}>
            <div
              style={{
                display: "flex",
                gap: 16,
                padding: "20px 24px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                background: "color-mix(in srgb, #8b5cf6 4%, var(--surface))",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "#8b5cf6",
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  fontSize: 18,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                <span className="material-icons" style={{ fontSize: 20 }}>hub</span>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 13, letterSpacing: "0.02em", textTransform: "uppercase", color: "#8b5cf6", marginBottom: 2 }}>
                  Mirrored to Nostr
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                  This listing is published as <code style={{ fontSize: 11, background: "var(--bg)", padding: "1px 4px", borderRadius: 4 }}>kind 30402</code> for discovery on Nostr. Anyone can view it via <code style={{ fontSize: 11 }}>naddr</code>.
                </div>
              </div>
              <ViewOnNostrBadge
                naddr={listingNaddr(auction.seller_nostr_pubkey, `egavel-${auction.id}`, [
                  "wss://relay.damus.io",
                  "wss://nos.lol",
                  "wss://relay.nostr.band",
                ])}
              />
            </div>
          </div>
        )}

        {/* ===== BELOW THE GRID: Settlement (for SETTLED auctions) ===== */}
        {auction.state === "SETTLED" && <SettlementInfo auction={auction} serverNpub="" />}
        {auction.state === "SETTLED" && <ClaimPanel auction={auction} />}

        {/* ===== BELOW THE GRID: Winner Checkout ===== */}
        <div style={{ gridColumn: "1 / -1" }}>
          <Checkout auction={auction} />
        </div>
      </div>
    </div>
  )
}
