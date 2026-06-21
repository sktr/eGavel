"use client"

import { useState } from "react"
import type { Auction } from "@cashu-auction/shared"
import { AuctionCard } from "./auction-card"

type Tab = "all" | "active" | "ending" | "reserve"

const tabs: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "ending", label: "Ending Soon" },
  { id: "reserve", label: "Won" },
]

function filterAuctions(auctions: Auction[], tab: Tab): Auction[] {
  const now = Date.now()
  switch (tab) {
    case "all":
      return auctions
    case "active":
      return auctions.filter((a) => a.state === "ACTIVE")
    case "ending":
      return auctions.filter((a) => a.end_time - now < 3600000 && a.end_time > now)
    case "reserve":
      return auctions.filter((a) => a.state === "ACTIVE" || a.state === "EXTENDED")
    default:
      return auctions
  }
}

export function AuctionGrid({ auctions }: { auctions: Auction[] }) {
  const [activeTab, setActiveTab] = useState<Tab>("all")
  const filtered = filterAuctions(auctions, activeTab)

  const sectionTitle =
    activeTab === "all" ? "All Auctions" : `${tabs.find((t) => t.id === activeTab)?.label}`

  return (
    <section>
      {/* Tab pill bar */}
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 24,
          background: "var(--surface)",
          padding: 4,
          borderRadius: 999,
          border: "1px solid var(--border)",
          width: "fit-content",
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 20px",
              borderRadius: 999,
              border: "none",
              background: activeTab === tab.id ? "var(--accent)" : "transparent",
              color: activeTab === tab.id ? "#fff" : "var(--muted)",
              font: "500 14px/1 var(--font-body)",
              cursor: "pointer",
              transition: "all .15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Section header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
      }}>
        <h2 style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: 20,
          letterSpacing: "-0.02em",
        }}>
          {sectionTitle}
        </h2>
        <span style={{ color: "var(--muted)", fontSize: 14, fontWeight: 500 }}>
          {filtered.length} listings
        </span>
      </div>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: 56 }}>
          No matching auctions found.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 24,
            marginBottom: 56,
          }}
        >
          {filtered.map((a) => (
            <AuctionCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </section>
  )
}
