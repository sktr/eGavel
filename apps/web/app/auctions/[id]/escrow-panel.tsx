"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Auction } from "@egavel/shared";
import { useIdentity } from "../../../lib/identity";
import { bytesToHex } from "../../../lib/hex";
import { fetchEscrow, markShipped, confirmReceipt, releaseEscrow, refundEscrow, type EscrowState } from "../../../lib/escrow";

const btnStyle = (busy: boolean): React.CSSProperties => ({
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--accent)",
  color: "#fff",
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: busy ? "not-allowed" : "pointer",
  opacity: busy ? 0.5 : 1,
});

export function EscrowPanel({ auction }: { auction: Auction }) {
  const { identity, isLoaded } = useIdentity();
  const [escrow, setEscrow] = useState<EscrowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const busyRef = useRef(false);

  const isSeller = !!identity && identity.pubkey === auction.seller_pubkey;
  const isWinner = !!identity && !!auction.winner_npub && identity.pubkey === auction.winner_npub;

  // Single fetch/error-mapping path shared by initial load, polling, and
  // post-action refreshes (previously duplicated three ways).
  const loadEscrow = useCallback(async (): Promise<EscrowState | null> => {
    if (!identity) return null;
    const skHex = bytesToHex(identity.secretKey);
    try {
      const data = await fetchEscrow(auction.id, identity.pubkey, skHex);
      setEscrow(data);
      setError(null);
      return data;
    } catch (e) {
      const msg = String(e);
      const status = (e as { status?: number }).status;
      if (status === 404 || msg.includes("NO_ESCROW") || msg.includes("not found")) {
        setEscrow(null);
        setError(null);
      } else {
        setError(msg);
      }
      return null;
    }
  }, [identity, auction.id]);

  useEffect(() => {
    if (!isLoaded || !identity) {
      setLoading(false);
      return;
    }
    if (!isSeller && !isWinner) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadEscrow().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, identity, isSeller, isWinner, loadEscrow]);

  // Keep escrow status fresh without a reload: the other party may ship or
  // confirm at any time. Skip while an action is in flight.
  useEffect(() => {
    if (!isLoaded || !identity || (!isSeller && !isWinner)) return;
    const id = setInterval(() => {
      if (!busyRef.current) void loadEscrow();
    }, 30_000);
    return () => clearInterval(id);
  }, [isLoaded, identity, isSeller, isWinner, loadEscrow]);

  const runAction = async (
    label: string,
    fn: () => Promise<unknown>,
  ) => {
    setBusy(true);
    busyRef.current = true;
    setActionError(null);
    setActionOk(null);
    try {
      await fn();
      setActionOk(label);
      await loadEscrow();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  if (!isLoaded) return null;
  if (!identity) return null;
  if (!isSeller && !isWinner) return null;
  if (loading) return <div style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--muted)" }}>Loading escrow…</div>;
  if (error) return <div style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--red)" }}>Escrow error: {error}</div>;
  if (!escrow) {
    const hint =
      auction.state !== "SETTLED"
        ? "Auction not yet settled — escrow will appear after the seller claims."
        : (auction as unknown as { claimed?: boolean }).claimed
          ? "No escrow for this auction — it was settled without escrow protection."
          : "No escrow yet — awaiting seller claim.";
    return <div style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--muted)" }}>{hint}</div>;
  }

  const escrowAmount = (() => {
    try {
      const d = JSON.parse(escrow.proofs_data) as { amount?: number; proofs?: { amount: number }[] };
      if (typeof d.amount === "number") return d.amount;
      if (Array.isArray(d.proofs)) return d.proofs.reduce((a, p) => a + (p.amount ?? 0), 0);
    } catch {}
    return null;
  })();

  const shipped = escrow.shipped === 1;
  const expired = !!escrow.timeout_expired;

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "24px 28px",
        marginBottom: 24,
        background: "var(--surface)",
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
        Escrow
      </h2>
      {escrowAmount != null && (
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 20, color: "var(--accent)", marginBottom: 6 }}>
          {escrowAmount.toLocaleString()} sats <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>in escrow</span>
        </div>
      )}
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
        {shipped ? "Shipped" : "Not yet shipped"}
        {expired && <span style={{ color: "var(--red)" }}> · Timeout expired</span>}
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, lineHeight: 1.5 }}>
        {isSeller
          ? shipped
            ? expired
              ? "The winner stayed silent for 14 days after shipping. You can release your proceeds to your wallet now."
              : "Your sale proceeds are locked here until the winner confirms receipt — or until 14 days after shipping, when you can release them yourself."
            : "Your sale proceeds are locked here, not in your wallet. Mark the lot as shipped once it's on its way, then DM the tracking number to the winner."
          : isWinner
            ? shipped
              ? "Confirm receipt after delivery to release the funds to the seller."
              : expired
                ? "The seller never marked this as shipped within 14 days. You can refund the escrow to your wallet now."
                : "Awaiting the seller to ship. If nothing ships within 14 days, you can refund yourself here."
            : ""}
      </p>
      {actionError && <p style={{ color: "var(--red)", fontSize: 13 }}>{actionError}</p>}
      {actionOk && <p style={{ color: "var(--accent2)", fontSize: 13 }}>{actionOk}</p>}

      {isSeller && !shipped && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() =>
              runAction("Marked as shipped", async () => {
                const skHex = bytesToHex(identity.secretKey);
                await markShipped(auction.id, identity.pubkey, skHex);
              })
            }
            disabled={busy}
            style={btnStyle(busy)}
          >
            {busy ? "Marking…" : "Mark shipped"}
          </button>
        </div>
      )}

      {isWinner && shipped && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() =>
              runAction("Receipt confirmed — funds released to seller", async () => {
                const skHex = bytesToHex(identity.secretKey);
                await confirmReceipt(auction.id, identity.pubkey, skHex);
              })
            }
            disabled={busy}
            style={btnStyle(busy)}
          >
            {busy ? "Confirming…" : "Confirm receipt"}
          </button>
        </div>
      )}

      {isSeller && shipped && expired && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() =>
              runAction("Payment released to your wallet collection", async () => {
                const skHex = bytesToHex(identity.secretKey);
                await releaseEscrow(auction.id, identity.pubkey, skHex);
              })
            }
            disabled={busy}
            style={btnStyle(busy)}
          >
            {busy ? "Releasing…" : "Release payment"}
          </button>
        </div>
      )}

      {isWinner && !shipped && expired && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() =>
              runAction("Refunded — funds moved to your wallet collection", async () => {
                const skHex = bytesToHex(identity.secretKey);
                await refundEscrow(auction.id, identity.pubkey, skHex);
              })
            }
            disabled={busy}
            style={btnStyle(busy)}
          >
            {busy ? "Refunding…" : "Refund"}
          </button>
        </div>
      )}
    </div>
  );
}
