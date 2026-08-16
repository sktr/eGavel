"use client"

import { useState, useRef, useEffect } from "react"
import { useIdentity } from "../lib/identity"
import { useTotalBalance } from "../lib/wallet"
import { shortHex } from "../lib/ident"
import { hexToNpub, nostrAtProfileUrl } from "../lib/npub"
import { fetchNostrLinkStatus } from "../lib/nostr-link"
import { bytesToHex } from "../lib/hex"
import { useTheme } from "@wrksz/themes/client"
import { ConnectDialog } from "../components/connect-dialog"

export function Header() {
  const { identity, isLoaded, login, logout, restore } = useIdentity()
  const { theme, setTheme } = useTheme()
  const { total, byMint, loading, refreshing, refresh } = useTotalBalance(identity?.pubkey ?? "")
  const [open, setOpen] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [copied, setCopied] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  // Linked Nostr pubkey (hex) — shown in the menu next to the trading key so
  // the user can see the identity buyers/sellers see on their listings.
  const [nostrPubkey, setNostrPubkey] = useState<string | null>(null)

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

  // Fetch the Nostr link status so the menu can show the linked npub.
  useEffect(() => {
    if (!identity) {
      setNostrPubkey(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const st = await fetchNostrLinkStatus(
          identity.pubkey,
          bytesToHex(identity.secretKey),
        )
        if (cancelled) return
        if (st.ok && st.nostrPubkey) setNostrPubkey(st.nostrPubkey)
        else setNostrPubkey(null)
      } catch {
        // transient failure — leave the previous state
      }
    })()
    return () => {
      cancelled = true
    }
  }, [identity])

  const copyKey = async () => {
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
        display: "flex", alignItems: "center", gap: "clamp(16px, 5vw, 24px)",
        padding: "16px 0", borderBottom: "1px solid var(--border)", flexWrap: "nowrap"
      }}>
        <a
          href="/"
          aria-label="eGavel home"
          style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
        >
          <span style={{
            width: 28, height: 28, borderRadius: 8, background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <img src="/gavel-icon.svg" alt="" width="16" height="16" style={{ display: "block" }} />
          </span>
          <span style={{
            fontFamily: "var(--font-display)", fontSize: "clamp(15px, 4vw, 20px)", fontWeight: 600,
            letterSpacing: "-0.02em", color: "var(--fg)", whiteSpace: "nowrap",
          }}>
            eGavel
          </span>
        </a>
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
                <span className="header-mobile-hide" style={{ fontFamily: "var(--font-mono)" }}>
                  {identity && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                      {shortHex(identity.pubkey)}
                    </span>
                  )}
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
                        {identity && (
                          <span style={{ fontSize: 11, color: "var(--muted)", wordBreak: "break-all" }}>
                            {identity.pubkey}
                          </span>
                        )}
                      </code>
                      <button
                        onClick={copyKey}
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
                    {nostrPubkey && (
                      <div style={{ marginTop: 6 }}>
                        <span style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 2 }}>
                          Nostr identity
                        </span>
                        <a
                          href={nostrAtProfileUrl(nostrPubkey)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={nostrPubkey}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                            color: "var(--fg)",
                            textDecoration: "none",
                          }}
                        >
                          <span style={{ wordBreak: "break-all" }}>
                            {(() => {
                              try {
                                const npub = hexToNpub(nostrPubkey)
                                return npub.length > 24 ? npub.slice(0, 14) + "…" + npub.slice(-10) : npub
                              } catch {
                                return nostrPubkey.slice(0, 14) + "…"
                              }
                            })()}
                          </span>
                        </a>
                      </div>
                    )}
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
              onClick={() => setShowConnect(true)}
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

      {showConnect && (
        <ConnectDialog
          onUseDevice={() => {
            setShowConnect(false);
            login();
          }}
          onRestore={(input) => {
            const res = restore(input);
            if (res.ok) setShowConnect(false);
            return res;
          }}
          onClose={() => setShowConnect(false)}
        />
      )}
    </div>
  )
}
