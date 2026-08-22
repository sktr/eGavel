import type { Auction } from "@egavel/shared"
import { LiveAuctionList } from "./live-auction-list"
import { CreateAuctionGuard } from "../components/create-auction-guard"
import { apiUrl } from "../lib/api"

// Server components resolve the base at request time: SSR_API_URL for
// server-side fetches, falling back to the public client URL.
const SSR_BASE = process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL

export async function AuctionList() {
  let initial: Auction[] = []
  try {
    const res = await fetch(apiUrl("/auctions", SSR_BASE), { cache: "no-store" })
    if (res.ok) initial = (await res.json()) as Auction[]
  } catch {
    // leave initial empty — the live list will surface the error state
  }

  if (initial.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>
        Could not load auctions. <CreateAuctionGuard>Create the first one</CreateAuctionGuard>.
      </div>
    )
  }

  return <LiveAuctionList initial={initial} />
}
