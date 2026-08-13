"use client";

import { useState, useEffect, useRef } from "react";
import type { Auction, PublicBid } from "@cashu-auction/shared";
import { DetailBidPanel } from "./detail-bid-panel";
import { useIdentity } from "../../../lib/identity";
import { useRouter } from "next/navigation";
import { refundBid } from "../../../lib/claim";
import { bytesToHex } from "../../../lib/hex";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
const POLL_MS = 4000;

function shortId(s: string) {
  if (s.length <= 16) return s;
  return s.slice(0, 8) + "..." + s.slice(-6);
}

/**
 * Live bid panel + history. Polls the server every few seconds so the
 * current bid updates when the user places a bid (which is processed
 * asynchronously via the relay/gift-wrap path) AND when other users bid.
 */
export function LiveBids({
  auction: initialAuction,
  bids: initialBids,
  serverNpub,
}: {
  auction: Auction;
  bids: PublicBid[];
  serverNpub: string;
}) {
  const [auction, setAuction] = useState(initialAuction);
  const [bids, setBids] = useState(initialBids);
  const { identity } = useIdentity();
  const router = useRouter();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Seller can remove a mistaken listing as long as no one has bid.
  const canDelete =
    identity !== null &&
    identity.pubkey === auction.seller_pubkey &&
    auction.state === "ACTIVE" &&
    bids.length === 0;

  async function handleDelete() {
    setDeleteError(null);
    if (!identity) return;
    if (!window.confirm("Delete this listing? It has no bids yet, so no funds are affected.")) return;
    try {
      const res = await fetch(`${API_BASE}/auctions/${auction.id}?seller_pubkey=${identity.pubkey}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "delete failed");
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setDeleteError(String(err));
    }
  }
  const failedRefundsRef = useRef(new Set<string>());

  // Auto-refund outbid bids on THIS auction: when a bidder is watching the
  // detail page and their bid gets outbid, the funds return immediately
  // (bidder + server co-sign, 2-of-3). The dashboard already does this; this
  // covers the natural "watching the auction" flow.
  useEffect(() => {
    if (!identity) return;
    const skHex = bytesToHex(identity.secretKey);
    let cancelled = false;
    const run = async () => {
      for (const b of bids) {
        if (cancelled) return;
        if (b.bidder_npub !== identity.pubkey) continue;
        if (b.status !== "outbid") continue;
        if (failedRefundsRef.current.has(b.id)) continue;
        try {
          await refundBid(b.id, b.bidder_npub, skHex);
        } catch {
          failedRefundsRef.current.add(b.id);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [bids, identity]);

  useEffect(() => {
    // Stop live polling once the auction is decided.
    if (auction.state === "SETTLED" || auction.state === "CLOSED") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [aRes, bRes] = await Promise.all([
          fetch(`${API_BASE}/auctions/${initialAuction.id}`, { cache: "no-store" }),
          fetch(`${API_BASE}/auctions/${initialAuction.id}/bids`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (aRes.ok) setAuction((await aRes.json()) as Auction);
        if (bRes.ok) setBids((await bRes.json()) as PublicBid[]);
      } catch {
        // transient network error — keep the last good data
      }
    };

    const first = setTimeout(poll, 400);
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [initialAuction.id, auction.state]);

  return (
    <>
      {canDelete && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 12,
            alignItems: "center",
            gap: 10,
          }}
        >
          {deleteError && <span style={{ fontSize: 12, color: "var(--red)" }}>{deleteError}</span>}
          <button
            type="button"
            onClick={handleDelete}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--surface)",
              color: "var(--red)",
              padding: "6px 14px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          >
            Delete listing
          </button>
        </div>
      )}
      <DetailBidPanel auction={auction} bids={bids} serverNpub={serverNpub} />

      {/* Bid History */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          marginTop: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 16px",
            background: "var(--surface)",
            fontSize: 13,
            fontWeight: 600,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span>Bid History ({bids.length})</span>
        </div>

        {bids.length === 0 ? (
          <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--muted)" }}>
            No bids yet.
          </div>
        ) : (
          bids.map((b: PublicBid) => (
            <div
              key={b.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 16px",
                fontSize: 13,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ color: "var(--accent)", fontWeight: 500 }}>
                {shortId(b.bidder_npub)}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {b.current_amount.toLocaleString()} sats
              </span>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                {new Date(b.received_at).toLocaleString("ja-JP", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
