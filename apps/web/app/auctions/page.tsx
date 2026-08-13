import type { Auction } from "@egavel/shared"
import { AuctionCard } from "../auction-card"
import { FilterBar } from "./filter-bar"

const API_BASE = (process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "")

const PAGE_SIZE = 16

export default async function AllAuctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; status?: string; page?: string }>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, parseInt(params.page ?? "1", 10) || 1)
  const sortBy = params.sort ?? "ending"
  const statusFilter = params.status ?? "all"

  // Fetch all auctions
  const res = await fetch(`${API_BASE}/api/auctions`, { cache: "no-store" })
  if (!res.ok) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px" }}>
        <p style={{ color: "var(--muted)" }}>Could not load auctions.</p>
      </div>
    )
  }

  const all: Auction[] = await res.json()

  // Filter by status
  let filtered = all
  if (statusFilter === "active") {
    filtered = all.filter((a) => a.state === "ACTIVE" || a.state === "EXTENDED")
  } else if (statusFilter === "settled") {
    filtered = all.filter((a) => a.state === "SETTLED")
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "ending") return a.end_time - b.end_time
    if (sortBy === "newest") return b.start_time - a.start_time
    if (sortBy === "price-low") return a.start_price - b.start_price
    if (sortBy === "price-high") return b.start_price - a.start_price
    return 0
  })

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const makeUrl = (overrides: Record<string, string>) => {
    const p = { sort: sortBy, status: statusFilter, page: String(currentPage), ...overrides }
    const qs = Object.entries(p)
      .filter(([, v]) => v !== "ending" && v !== "all" && v !== "1")
      .map(([k, v]) => `${k}=${v}`)
      .join("&")
    return `/auctions${qs ? "?" + qs : ""}`
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* Breadcrumb */}
      <ul style={{
        display: "flex", gap: 8, padding: "16px 0 24px",
        fontSize: 13, color: "var(--muted)", listStyle: "none"
      }}>
        <li><a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>Home</a></li>
        <li style={{ marginLeft: 8 }}><span style={{ color: "var(--muted)", marginRight: 8, fontSize: 16, opacity: 0.6 }}>/</span>All Auctions</li>
      </ul>

      {/* Filter bar */}
      <FilterBar total={sorted.length} currentSort={sortBy} currentStatus={statusFilter} />

      {/* Card grid */}
      {paginated.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>
          No auctions match your filters.
        </p>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 24,
        }}>
          {paginated.map((a) => (
            <AuctionCard key={a.id} a={a} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "center",
          gap: 8, padding: "40px 0 64px",
        }}>
          {currentPage > 1 && (
            <a href={makeUrl({ page: String(currentPage - 1) })} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              minWidth: 36, height: 36, border: "1px solid var(--border)",
              borderRadius: "var(--radius)", fontSize: 14, color: "var(--fg)",
              background: "var(--surface)", textDecoration: "none",
            }}><span className="material-icons" style={{ fontSize: 16 }}>chevron_left</span></a>
           )}
           {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const pageNum = i + 1
            const isCurrent = pageNum === currentPage
            return (
              <a
                key={pageNum}
                href={isCurrent ? "#" : makeUrl({ page: String(pageNum) })}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  minWidth: 36, height: 36,
                  border: `1px solid ${isCurrent ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "var(--radius)", fontSize: 14,
                  color: isCurrent ? "#fff" : "var(--fg)",
                  background: isCurrent ? "var(--accent)" : "var(--surface)",
                  textDecoration: "none", cursor: isCurrent ? "default" : "pointer",
                }}
              >
                {pageNum}
              </a>
            )
          })}
          {currentPage < totalPages && (
            <a href={makeUrl({ page: String(currentPage + 1) })} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              minWidth: 36, height: 36, border: "1px solid var(--border)",
              borderRadius: "var(--radius)", fontSize: 14, color: "var(--fg)",
              background: "var(--surface)", textDecoration: "none",
            }}><span className="material-icons" style={{ fontSize: 16 }}>chevron_right</span></a>
          )}
        </div>
      )}
    </div>
  )
}
