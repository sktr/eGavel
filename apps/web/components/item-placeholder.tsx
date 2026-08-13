import type { CSSProperties } from "react"
import { CATEGORY_PLACEHOLDERS, placeholderFor, itemInitial } from "../lib/placeholder"

export function ItemPlaceholder({
  category,
  name,
  size = 28,
  style,
}: {
  category?: string
  name?: string
  size?: number
  style?: CSSProperties
}) {
  const known = !!category && category in CATEGORY_PLACEHOLDERS
  const p = placeholderFor(category)
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: p.bg,
        color: p.fg,
        ...style,
      }}
    >
      {known ? (
        <span className="material-icons" style={{ fontSize: size }}>
          {p.icon}
        </span>
      ) : (
        <span style={{ fontSize: Math.round(size * 0.9), fontWeight: 700, letterSpacing: "0.02em" }}>
          {itemInitial(name)}
        </span>
      )}
    </div>
  )
}
