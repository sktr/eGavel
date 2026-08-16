"use client";

import { useIdentity } from "../../../lib/identity";
import type { Auction } from "@egavel/shared";
import { hexToNpub, nostrAtProfileUrl } from "../../../lib/npub";
import { shortHex } from "../../../lib/ident";

function shortNpub(pubkeyHex: string): string {
  let npub: string
  try {
    npub = hexToNpub(pubkeyHex)
  } catch {
    return pubkeyHex.slice(0, 12) + "…"
  }
  return npub.length > 20 ? npub.slice(0, 12) + "…" + npub.slice(-8) : npub
}

/**
 * "You won" card shown to the winner of a settled auction.
 *
 * The seller's linked Nostr pubkey is public info, so the winner can reach
 * out directly: the card shows the seller's handle with a nostr.at link
 * (open the profile in any Nostr app / browser).
 */
export function Checkout({ auction }: { auction: Auction }) {
  const { identity } = useIdentity();
  // winnerNpub is stored as the bidder's HEX pubkey — compare hex-vs-hex, not npub.
  const isWinner = identity && auction.winner_npub && identity.pubkey === auction.winner_npub;
  if (!isWinner || !identity) return null;

  const sellerNpub = auction.seller_nostr_pubkey
  const hasSellerLink = Boolean(sellerNpub)

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginTop: 24,
      }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>You won</h2>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
        Congratulations — contact the seller to arrange delivery and payment. The seller can
        also see your Nostr handle in the Settlement Info.
      </p>
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "12px 14px",
        }}
      >
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Seller</div>
        {hasSellerLink ? (
          <>
            <code
              style={{
                display: "block",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: 12,
                lineHeight: 1.5,
                marginBottom: 10,
              }}
              title={sellerNpub}
            >
              {shortNpub(sellerNpub!)}
            </code>
            <a
              href={nostrAtProfileUrl(sellerNpub!)}
              target="_blank"
              rel="noopener noreferrer"
              title={sellerNpub}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                border: "1px solid var(--accent)",
                borderRadius: "var(--radius)",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "inherit",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              <span className="material-icons" style={{ fontSize: 14 }}>open_in_new</span>
              Open on nostr.at
            </a>
          </>
        ) : (
          <code style={{ fontSize: 12, color: "var(--muted)" }}>
            {shortHex(auction.seller_pubkey)}
          </code>
        )}
      </div>
    </div>
  );
}
