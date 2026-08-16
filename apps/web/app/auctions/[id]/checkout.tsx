"use client";

import { useState } from "react";
import { useIdentity } from "../../../lib/identity";
import { hexToNpub } from "../../../lib/npub";
import { shortHex } from "../../../lib/ident";

function shortNpub(npub: string): string {
  return npub.length > 20 ? npub.slice(0, 12) + "…" + npub.slice(-8) : npub;
}

export function Checkout({
  winnerNpub,
  winnerNostrPubkey = "",
}: {
  winnerNpub: string;
  winnerNostrPubkey?: string;
}) {
  const { identity } = useIdentity();
  const [copied, setCopied] = useState(false);
  // winnerNpub is stored as the bidder's HEX pubkey — compare hex-vs-hex, not npub.
  const isWinner = identity && winnerNpub && identity.pubkey === winnerNpub;
  if (!isWinner || !identity) return null;

  // Display the winner's LINKED Nostr npub when present (the checkout is shown
  // to the winner themselves, so their own linked key is available). Fall back
  // to the trading-key hex short form otherwise — the trading key is not a
  // Nostr identity, so no nostr: link in that case.
  const hasLinkedNostr = Boolean(winnerNostrPubkey);
  const npub = hasLinkedNostr ? hexToNpub(winnerNostrPubkey) : shortHex(identity.pubkey);
  // Full handle for the hover title: the full npub when linked, the full
  // trading-key hex otherwise (the short form is just a truncated display).
  const titleHandle = hasLinkedNostr ? npub : identity.pubkey;

  const copyNpub = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

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
        The seller can see your Nostr handle in the Settlement Info — reach out to them on
        Nostr to arrange delivery and payment. Your handle:
      </p>
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "12px 14px",
        }}
      >
        <code
          style={{
            display: "block",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: 12,
            lineHeight: 1.5,
          }}
          title={titleHandle}
        >
          {shortNpub(npub)}
        </code>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={copyNpub}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--surface)",
              color: "var(--fg)",
              padding: "6px 12px",
              fontSize: 12,
              fontFamily: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
