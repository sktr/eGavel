"use client";

import { useEffect, useState } from "react";
import type { Auction } from "@egavel/shared";
import { useIdentity } from "../../../lib/identity";
import { bytesToHex } from "../../../lib/hex";
import { fetchEscrow, markShipped, confirmReceipt, type EscrowState } from "../../../lib/escrow";

export function EscrowPanel({ auction }: { auction: Auction }) {
  const { identity, isLoaded } = useIdentity();
  const [escrow, setEscrow] = useState<EscrowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const isSeller = !!identity && identity.pubkey === auction.seller_pubkey;
  const isWinner = !!identity && !!auction.winner_npub && identity.pubkey === auction.winner_npub;

  const refresh = async () => {
    if (!identity) return;
    const skHex = bytesToHex(identity.secretKey);
    try {
      const data = await fetchEscrow(auction.id, identity.pubkey, skHex);
      setEscrow(data);
      setError(null);
    } catch (e) {
      const msg = String(e);
      const status = (e as { status?: number }).status;
      if (status === 404 || msg.includes("NO_ESCROW") || msg.includes("not found")) {
        setEscrow(null);
        setError(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

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
    (async () => {
      setLoading(true);
      try {
        const skHex = bytesToHex(identity.secretKey);
        const data = await fetchEscrow(auction.id, identity.pubkey, skHex);
        if (!cancelled) {
          setEscrow(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = String(e);
          const status = (e as { status?: number }).status;
          if (status === 404 || msg.includes("NO_ESCROW") || msg.includes("not found")) {
            setEscrow(null);
            setError(null);
          } else {
            setError(msg);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, identity, isSeller, isWinner, auction.id]);

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

  const handleMarkShipped = async () => {
    if (!identity) return;
    setBusy(true);
    setActionError(null);
    setActionOk(null);
    try {
      const skHex = bytesToHex(identity.secretKey);
      await markShipped(auction.id, identity.pubkey, skHex);
      setActionOk("Marked as shipped");
      await refresh();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!identity) return;
    setBusy(true);
    setActionError(null);
    setActionOk(null);
    try {
      const skHex = bytesToHex(identity.secretKey);
      await confirmReceipt(auction.id, identity.pubkey, skHex);
      setActionOk("Receipt confirmed — funds released to seller");
      await refresh();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const escrowAmount = (() => {
    try {
      const d = JSON.parse(escrow.proofs_data) as { amount?: number; proofs?: { amount: number }[] };
      if (typeof d.amount === "number") return d.amount;
      if (Array.isArray(d.proofs)) return d.proofs.reduce((a, p) => a + (p.amount ?? 0), 0);
    } catch {}
    return null;
  })();

  const shipped = escrow.shipped === 1;

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
        {escrow.timeout_expired && (
          <span style={{ color: "var(--red)" }}> · Timeout expired</span>
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, lineHeight: 1.5 }}>
        {isSeller
          ? "Your sale proceeds are locked here, not in your wallet. They will move to your wallet after the winner confirms receipt (or after timeout if the winner goes silent)."
          : isWinner
            ? "The seller's proceeds are locked here. Confirm receipt after delivery to release them."
            : ""}
      </p>
      {actionError && <p style={{ color: "var(--red)", fontSize: 13 }}>{actionError}</p>}
      {actionOk && <p style={{ color: "var(--accent2)", fontSize: 13 }}>{actionOk}</p>}

      {isSeller && !shipped && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={handleMarkShipped}
            disabled={busy}
            style={{
              border: "none",
              borderRadius: "var(--radius)",
              background: "var(--accent)",
              color: "#fff",
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? "Marking…" : "Mark shipped"}
          </button>
        </div>
      )}

      {isWinner && shipped && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            style={{
              border: "none",
              borderRadius: "var(--radius)",
              background: "var(--accent)",
              color: "#fff",
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? "Confirming…" : "Confirm receipt"}
          </button>
        </div>
      )}
    </div>
  );
}
