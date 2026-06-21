"use client"

import { useRouter } from "next/navigation"

export function FilterBar({
  total,
  currentSort,
  currentStatus,
}: {
  total: number
  currentSort: string
  currentStatus: string
}) {
  const router = useRouter()

  function update(params: Record<string, string>) {
    const sp = new URLSearchParams()
    if (params.sort && params.sort !== "ending") sp.set("sort", params.sort)
    if (params.status && params.status !== "all") sp.set("status", params.status)
    const qs = sp.toString()
    router.push(`/auctions${qs ? "?" + qs : ""}`)
  }

  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
        paddingBottom: 24, borderBottom: "1px solid var(--border)", marginBottom: 24,
      }}
    >
      {/* Result count */}
      <span style={{ fontSize: 14, color: "var(--muted)", marginRight: "auto" }}>
        <strong style={{ color: "var(--fg)", fontWeight: 600 }}>{total}</strong> items
      </span>

      {/* Active category pill */}
      <span
        style={{
          background: "var(--accent)", color: "#fff", borderRadius: 100,
          padding: "4px 14px", fontSize: 13,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}
      >
        All Categories
        <button
          style={{ background: "none", border: "none", color: "inherit", fontSize: 16, cursor: "pointer", lineHeight: 1, padding: 0 }}
          onClick={() => {}}
        >
          <span className="material-icons" style={{ fontSize: 16 }}>close</span>
        </button>
      </span>

      {/* Sort */}
      <select
        value={currentSort}
        onChange={(e) => update({ sort: e.target.value })}
        style={{
          width: "auto", minWidth: 160,
          border: "1px solid var(--border)", borderRadius: "var(--radius)",
          padding: "6px 32px 6px 12px", fontSize: 13, fontFamily: "inherit",
          background: "var(--surface)", color: "var(--fg)", cursor: "pointer",
          appearance: "none",
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23858585' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
        }}
      >
        <option value="ending">Sort: Ending Soon</option>
        <option value="newest">Sort: Newest</option>
        <option value="price-low">Sort: Price Low</option>
        <option value="price-high">Sort: Price High</option>
      </select>

      {/* Status */}
      <select
        value={currentStatus}
        onChange={(e) => update({ status: e.target.value })}
        style={{
          width: "auto", minWidth: 120,
          border: "1px solid var(--border)", borderRadius: "var(--radius)",
          padding: "6px 32px 6px 12px", fontSize: 13, fontFamily: "inherit",
          background: "var(--surface)", color: "var(--fg)", cursor: "pointer",
          appearance: "none",
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23858585' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
        }}
      >
        <option value="all">Status: All</option>
        <option value="active">Active</option>
        <option value="settled">Settled</option>
      </select>
    </div>
  )
}
