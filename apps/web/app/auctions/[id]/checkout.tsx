"use client";

import { useState } from "react";
import { useIdentity } from "../../../lib/identity";
import { hexToNpub, nostrProfileUri } from "../../../lib/npub";

export function Checkout({ winnerNpub }: { winnerNpub: string }) {
  const { identity } = useIdentity();
  const [copied, setCopied] = useState(false);
  // winnerNpub is stored as the bidder's HEX pubkey — compare hex-vs-hex, not npub.
  const isWinner = identity && winnerNpub && identity.pubkey === winnerNpub;
  if (!isWinner || !identity) return null;

  const npub = hexToNpub(identity.pubkey);
  const nostrUri = nostrProfileUri(identity.pubkey);

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
        Share your contact handle so the seller can reach you. The seller can open it in
        their Nostr app and message you directly.
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "10px 12px",
        }}
      >
        <code style={{ wordBreak: "break-all", fontSize: 12, flex: 1, minWidth: 0 }}>
          {npub}
        </code>
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
        <a
          href={nostrUri}
          style={{
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
          Open in Nostr app
        </a>
      </div>
    </div>
  );
}
