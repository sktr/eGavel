"use client";

import { useEffect, useState } from "react";
import type { Auction } from "@egavel/shared";
import { useIdentity } from "../../../lib/identity";
import { apiUrl } from "../../../lib/api";
import { bytesToHex } from "../../../lib/hex";
import { signSecretHex } from "../../../lib/claim";
import { hexToNpub, nostrAtProfileUrl } from "../../../lib/npub";
import { shortHex } from "../../../lib/ident";

function fullNpub(pubkeyHex: string): string {
  return /^[0-9a-fA-F]{64}$/.test(pubkeyHex) ? hexToNpub(pubkeyHex) : pubkeyHex
}

function shortNpub(pubkeyHex: string): string {
  const npub = fullNpub(pubkeyHex)
  return npub.length > 20 ? npub.slice(0, 12) + "…" + npub.slice(-8) : npub
}

/**
 * Settlement Info for a settled auction.
 *
 * The winner stays anonymous to everyone EXCEPT the seller: the server only
 * reveals the winner's linked Nostr pubkey when the request is signed by the
 * seller's key (GET /auctions/:id?seller_pubkey=&seller_sig=). This component
 * re-fetches with that signature when the viewer IS the seller, so they can
 * verify an inbound contact is the genuine winner. Everyone else sees
 * "Winner — anonymous".
 */
export function SettlementInfo({
  auction,
  serverNpub: _serverNpub,
}: {
  auction: Auction
  serverNpub: string
}) {
  const { identity, isLoaded } = useIdentity()
  const [sellerView, setSellerView] = useState<Auction | null>(null)

  // If the current account is the seller, fetch the seller-signed view to
  // reveal the winner's identity.
  useEffect(() => {
    if (!isLoaded || !identity) return
    if (identity.pubkey !== auction.seller_pubkey) return
    let cancelled = false
    ;(async () => {
      try {
        const sig = signSecretHex(`winner-view:${auction.id}`, bytesToHex(identity.secretKey))
        const res = await fetch(
          apiUrl(`/auctions/${auction.id}?seller_pubkey=${identity.pubkey}&seller_sig=${sig}`),
          { cache: "no-store" },
        )
        if (cancelled || !res.ok) return
        const data = (await res.json()) as Auction
        setSellerView(data)
      } catch {
        // transient — keep the anonymous view
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isLoaded, identity, auction.id, auction.seller_pubkey])

  const winnerNostrPubkey = sellerView?.winner_nostr_pubkey

  return (
    <div
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        padding: "24px 28px",
        gridColumn: "1 / -1",
        marginBottom: 24,
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: 18,
          marginBottom: 12,
        }}
      >
        Settlement Info
      </h2>
      {auction.winner_npub ? (
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 22,
              color: "var(--accent2)",
            }}
          >
            {auction.winning_amount?.toLocaleString()} sats
          </div>
          <div style={{ marginTop: 4 }}>
            {winnerNostrPubkey ? (
              <>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Winner: </span>
                <a
                  href={nostrAtProfileUrl(winnerNostrPubkey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={winnerNostrPubkey}
                  style={{ color: "inherit", textDecoration: "underline dotted" }}
                >
                  {shortNpub(winnerNostrPubkey)}
                </a>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {" "}
                  (visible to you as the seller)
                </span>
              </>
            ) : (
              <code style={{ fontSize: 13 }}>Winner — anonymous</code>
            )}
          </div>
        </div>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Reserve price not met — no winner
        </p>
      )}
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: 15,
          marginTop: 16,
          marginBottom: 8,
        }}
      >
        Contact
      </h3>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>
        Seller: <code>{shortHex(auction.seller_pubkey)}</code>
        {auction.winner_npub && (
          <>
            {" "}
            · Winner:{" "}
            <code>
              {winnerNostrPubkey ? shortNpub(winnerNostrPubkey) : "anonymous"}
            </code>
          </>
        )}
      </div>
    </div>
  )
}
