"use client"

import { useState } from "react"
import type { Auction } from "@egavel/shared"
import { ItemPlaceholder } from "../../../components/item-placeholder"

export function Gallery({ auction }: { auction: Auction }) {
  const images = auction.images ?? []
  const [active, setActive] = useState(0)
  const current = images[active] ?? images[0]
  const isOpen = auction.state === "ACTIVE" || auction.state === "EXTENDED"

  return (
    <div>
      {/* Main image */}
      <div
        style={{
          aspectRatio: "4 / 3",
          background: "var(--placeholder)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: 14,
          marginBottom: 8,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {current ? (
          <img
            src={current}
            alt={auction.item}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <ItemPlaceholder category={auction.category} name={auction.item} size={40} />
        )}
        {isOpen && (
          <span
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 999,
              font: "600 12px/1.3 -apple-system, sans-serif",
              letterSpacing: "0.02em",
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            <span className="material-icons" style={{ fontSize: 14 }}>
              local_fire_department
            </span>{" "}
            {auction.state === "EXTENDED" ? "Extended" : "Active"}
          </span>
        )}
      </div>

      {/* Thumbnails — only when there are images */}
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8 }}>
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Image ${i + 1}`}
              style={{
                width: 72,
                height: 56,
                padding: 0,
                border: i === active ? "2px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: 4,
                overflow: "hidden",
                cursor: "pointer",
                background: "var(--placeholder)",
                boxSizing: "border-box",
              }}
            >
              <img
                src={src}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
