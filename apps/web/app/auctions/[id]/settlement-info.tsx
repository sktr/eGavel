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

/** Seller display: linked seller's npub (nostr.at link) when available, else
 * the short trading-key hex. The seller's identity is public info. */
function SellerDisplay({ auction }: { auction: Auction }) {
  const linked = auction.seller_nostr_pubkey
  if (linked) {
    return (
      <a
        href={nostrAtProfileUrl(linked)}
        target="_blank"
        rel="noopener noreferrer"
        title={linked}
        style={{ color: "inherit", textDecoration: "underline dotted" }}
      >
        {shortNpub(linked)}
      </a>
    )
  }
  return <span title={auction.seller_pubkey}>{shortHex(auction.seller_pubkey)}</span>
}

/**
 * Settlement Info for a settled auction.
 *
 * The winner stays anonymous to the public. It is revealed in two cases:
 * - the viewer IS the seller (server requires a Schnorr signature over
 *   `winner-view:<id>` — only then does the response include the winner's
 *   linked Nostr pubkey), so they can verify an inbound contact is genuine;
 * - the viewer IS the winner themselves (their own key is already known).
 * Everyone else sees "Winner — anonymous".
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

  const isWinnerViewer = identity?.pubkey === auction.winner_npub

  // If the current account is the seller or the winner, fetch the signed view
  // to reveal the winner's identity (their own handle for the winner).
  useEffect(() => {
    if (!isLoaded || !identity) return
    const canView =
      identity.pubkey === auction.seller_pubkey || identity.pubkey === auction.winner_npub
    if (!canView) return
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
  }, [isLoaded, identity, auction.id, auction.seller_pubkey, auction.winner_npub])

  // The winner is revealed to the seller (via the signed fetch) or to the
  // winner themselves (their own linked key).
  const winnerNostrPubkey =
    sellerView?.winner_nostr_pubkey ??
    (isWinnerViewer && auction.winner_npub
      ? auction.winner_nostr_pubkey
      : undefined)

  const winnerHandle = winnerNostrPubkey ? shortNpub(winnerNostrPubkey) : "anonymous"

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
                  {winnerHandle}
                </a>
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
        Seller: <SellerDisplay auction={auction} />
        {auction.winner_npub && (
          <>
            {" "}
            · Winner:{" "}
            {winnerNostrPubkey ? (
              <a
                href={nostrAtProfileUrl(winnerNostrPubkey)}
                target="_blank"
                rel="noopener noreferrer"
                title={winnerNostrPubkey}
                style={{ color: "inherit", textDecoration: "underline dotted" }}
              >
                {winnerHandle}
              </a>
            ) : (
              <code>anonymous</code>
            )}
          </>
        )}
      </div>
    </div>
  )
}
