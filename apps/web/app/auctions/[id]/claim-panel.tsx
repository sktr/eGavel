"use client";

import { useState } from "react";
import type { Auction } from "@egavel/shared";
import { useIdentity } from "../../../lib/identity";
import { claimAuction } from "../../../lib/claim";
import { bytesToHex } from "../../../lib/hex";

export function ClaimPanel({
  auction,
  isSeller,
  isWinner,
}: {
  auction: Auction;
  isSeller: boolean;
  isWinner: boolean;
}) {
  const { identity } = useIdentity();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canClaim =
    isSeller && auction.state === "SETTLED" && auction.winner_npub !== null && !auction.claimed;

  const claim = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (!identity) {
        throw new Error("identity not loaded");
      }
      if (identity.pubkey !== auction.seller_pubkey) {
        throw new Error("claim requires the in-app key that created this auction");
      }
      const result = await claimAuction(
        auction.id,
        auction.seller_pubkey,
        bytesToHex(identity.secretKey),
      );
      setStatus(
        `Claimed ${(auction.winning_amount ?? 0).toLocaleString()} sats to your wallet (${result.proofs.length} proof${result.proofs.length === 1 ? "" : "s"})${result.fee > 0 ? ` — platform fee ${result.fee} sats` : ""}.`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Never render the claim button once the seller has claimed — the server
  // persists `claimed` on the auction, so this survives page reloads (the
  // input proofs are already spent at the mint; a second claim would 500).
  if (!canClaim || auction.claimed) return null;

  return (
    <div style={{ marginTop: 12 }}>
      {status === null && (
        <button
          type="button"
          onClick={claim}
          disabled={busy}
          style={{
            border: "none",
            borderRadius: "var(--radius)",
            background: "var(--accent)",
            color: "#fff",
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Claiming…" : `Claim ${(auction.winning_amount ?? 0).toLocaleString()} sats`}
        </button>
      )}
      {error && <p style={{ color: "var(--red)", fontSize: 13, margin: "6px 0 0" }}>{error}</p>}
      {status && (
        <p style={{ color: "var(--accent2)", fontSize: 13, margin: "6px 0 0" }}>{status}</p>
      )}
    </div>
  );
}
