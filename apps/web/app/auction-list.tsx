import type { Auction } from "@egavel/shared"
import { LiveAuctionList } from "./live-auction-list"

const API_BASE = (process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "")

export async function AuctionList() {
  let initial: Auction[] = []
  try {
    const res = await fetch(`${API_BASE}/api/auctions`, { cache: "no-store" })
    if (res.ok) initial = (await res.json()) as Auction[]
  } catch {
    // leave initial empty — the live list will surface the error state
  }

  if (initial.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>
        Could not load auctions. <a href="/create">Create the first one</a>.
      </div>
    )
  }

  return <LiveAuctionList initial={initial} />
}
