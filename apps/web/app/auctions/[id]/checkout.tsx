"use client";

import { useIdentity } from "../../../lib/identity";
import { hexToNpub } from "../../../lib/npub";

export function Checkout({ winnerNpub }: { winnerNpub: string }) {
  const { identity } = useIdentity();
  const isWinner = identity && winnerNpub && identity.pubkey === winnerNpub;
  if (!isWinner || !identity) return null;

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
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>
        Share your contact handle so the seller can reach you:
      </p>
      <code style={{ wordBreak: "break-all", fontSize: 12 }}>{hexToNpub(identity.pubkey)}</code>
    </div>
  );
}
