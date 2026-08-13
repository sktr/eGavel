"use client"

import { useState, useRef, useEffect } from "react"
import { useIdentity } from "../lib/identity"
import { useTotalBalance } from "../lib/wallet"
import { useTheme } from "@wrksz/themes/client"

export function Header() {
  const { identity, isLoaded, login, logout } = useIdentity()
  const { theme, setTheme } = useTheme()
  const { total, byMint, loading, refreshing, refresh } = useTotalBalance()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  // Close the dropdown when clicking outside
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const copyNpub = async () => {
    if (!identity) return
    try {
      await navigator.clipboard.writeText(identity.pubkey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className="container" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      <nav style={{
        display: "flex", alignItems: "center", gap: 24,
        padding: "16px 0", borderBottom: "1px solid var(--border)", flexWrap: "nowrap"
      }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span className="material-icons" style={{ fontSize: 16, color: "#fff" }}>gavel</span>
          </span>
          <span style={{
            fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600,
            letterSpacing: "-0.02em", color: "var(--fg)", whiteSpace: "nowrap",
          }}>
            cashu auction
          </span>
        </a>
        <div style={{ display: "flex", gap: 24, listStyle: "none" }}>
          <a href="/" style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}>Auctions</a>
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

          {isLoaded && identity ? (
            <div ref={popRef} style={{ position: "relative" }}>
              <button
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: 100, padding: "6px 12px", cursor: "pointer",
                  color: "var(--fg)", fontSize: 13, minHeight: 0, lineHeight: 1.4,
                }}
              >
                <span className="material-icons" style={{ fontSize: 16, color: "var(--accent)" }}>
                  person
                </span>
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {identity.pubkey.slice(0, 12)}…
                </span>
                {!loading && (
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 600 }}>
                    {total.toLocaleString()}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}> sats</span>
                  </span>
                )}
                <span className="material-icons" style={{ fontSize: 14, color: "var(--muted)" }}>
                  {open ? "expand_less" : "expand_more"}
                </span>
              </button>

              {open && (
                <div
                  role="menu"
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0,
                    width: 280, background: "var(--surface)",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
                    boxShadow: "var(--shadow-hover)", padding: 12, zIndex: 100,
                    display: "flex", flexDirection: "column", gap: 8,
                  }}
                >
                  {/* Balance */}
                  <div style={{ padding: "4px 4px 10px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>Balance</span>
                      <button
                        onClick={refresh}
                        disabled={refreshing}
                        aria-label="Refresh balance"
                        style={{
                          background: "none", border: "none", cursor: refreshing ? "not-allowed" : "pointer",
                          color: "var(--muted)", padding: 0, minHeight: 0, lineHeight: 1, fontSize: 15, opacity: refreshing ? 0.4 : 1,
                        }}
                      >
                        <span className="material-icons" style={{ fontSize: 16 }}>refresh</span>
                      </button>
                    </div>
                    {loading ? (
                      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Loading…</p>
                    ) : (
                      <>
                        <p style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, marginTop: 2 }}>
                          {total.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--muted)" }}>sats</span>
                        </p>
                        {byMint.length > 0 && (
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                            {byMint.map((m) => (
                              <div key={m.mint} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>
                                  {m.mint.replace(/^https?:\/\//, "")}
                                </span>
                                <span style={{ fontFamily: "var(--font-mono)" }}>{m.amount.toLocaleString()} sats</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Identity */}
                  <div style={{ padding: "2px 4px" }}>
                    <span style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                      In-app key
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <code style={{ flex: 1, fontSize: 11, wordBreak: "break-all", background: "transparent", padding: 0 }}>
                        {identity.pubkey}
                      </code>
                      <button
                        onClick={copyNpub}
                        aria-label="Copy pubkey"
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          color: copied ? "var(--success)" : "var(--muted)", padding: 0, minHeight: 0, lineHeight: 1, fontSize: 15,
                        }}
                      >
                        <span className="material-icons" style={{ fontSize: 15 }}>
                          {copied ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    <a
                      href="/dashboard"
                      onClick={() => setOpen(false)}
                      role="menuitem"
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        color: "var(--fg)", fontSize: 13, textDecoration: "none",
                        padding: "6px 4px", borderRadius: "var(--radius)",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span className="material-icons" style={{ fontSize: 15, color: "var(--muted)" }}>dashboard</span>
                      Dashboard
                    </a>
                    <button
                      onClick={() => { setOpen(false); logout() }}
                      role="menuitem"
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--red, #dc2626)", fontSize: 13, textAlign: "left",
                        padding: "6px 4px", borderRadius: "var(--radius)",
                        minHeight: 0, lineHeight: 1.4,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span className="material-icons" style={{ fontSize: 15 }}>logout</span>
                      Log out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : isLoaded ? (
            <button
              onClick={login}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 100, padding: "6px 14px", cursor: "pointer",
                color: "var(--fg)", fontSize: 13, minHeight: 0, lineHeight: 1.4,
              }}
            >
              <span className="material-icons" style={{ fontSize: 16, color: "var(--accent)" }}>person_add</span>
              Connect
            </button>
          ) : null}
        </div>
      </nav>
    </div>
  )
}
