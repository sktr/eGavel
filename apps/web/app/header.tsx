"use client"

import { useIdentity } from "../lib/identity"
import { useTheme } from "@wrksz/themes/client"

export function Header() {
  const { identity, isLoaded } = useIdentity()
  const { theme, setTheme } = useTheme()

  return (
    <div className="container" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      <nav style={{
        display: "flex", alignItems: "center", gap: 24,
        padding: "16px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap"
      }}>
        <a href="/" style={{
          fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600,
          letterSpacing: "-0.02em", color: "var(--fg)", textDecoration: "none"
        }}>
          cashu auction
        </a>
        <div style={{ display: "flex", gap: 24, listStyle: "none" }}>
          <a href="/" style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}>Auctions</a>
          <a href="/how-it-works" style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}>How it Works</a>
          <a href="/dashboard" style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}>Dashboard</a>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            style={{
              background: "none", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: "4px 8px",
              fontSize: 15, cursor: "pointer", color: "var(--muted)",
              lineHeight: 1, minHeight: 0,
            }}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <span className="material-icons" style={{ fontSize: 18 }}>light_mode</span>
            ) : (
              <span className="material-icons" style={{ fontSize: 18 }}>dark_mode</span>
            )}
          </button>
          {isLoaded && identity && (
            <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--font-mono)", alignSelf: "center" }}>
              {identity.npub.slice(0, 12)}…
            </span>
          )}
        </div>
      </nav>
    </div>
  )
}
