"use client";

import { useState, useEffect, useRef } from "react";
import type { Auction, PublicBid } from "@egavel/shared";
import { DetailBidPanel } from "./detail-bid-panel";
import { useIdentity } from "../../../lib/identity";
import { refundBid } from "../../../lib/claim";
import { bytesToHex } from "../../../lib/hex";

// Root (no /api suffix) — the code below adds "/api" explicitly. Matches the
// convention in lib/claim.ts and checkout.tsx so NEXT_PUBLIC_API_URL can point
// at the Worker origin without a trailing path.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

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
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastJson = "";

    // Adaptive backoff: poll fast while things change, slow down while idle.
    // (Bids are rare, so most polls see no change — backing off cuts the
    // request rate dramatically without adding visible latency.)
    const BACKOFF_LEVELS = [4000, 10_000, 30_000, 60_000];
    let level = 0;

    const poll = async () => {
      try {
        // Combined endpoint: auction + bids in one request (with_bids=1).
        const res = await fetch(
          `${API_BASE}/api/auctions/${initialAuction.id}?with_bids=1`,
          { cache: "no-store" },
        );
        if (cancelled || !res.ok) return;
        const json = await res.text();
        if (json === lastJson) {
          // Nothing changed — back off (capped at the slowest level).
          level = Math.min(level + 1, BACKOFF_LEVELS.length - 1);
          return;
        }
        lastJson = json;
        level = 0; // something changed — poll fast again
        const data = JSON.parse(json) as { auction: Auction; bids: PublicBid[] };
        setAuction(data.auction);
        setBids(data.bids);
      } catch {
        // transient network error — keep the last good data
      } finally {
        if (!cancelled && !document.hidden) restartTimer();
      }
    };

    const restartTimer = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(poll, BACKOFF_LEVELS[level] ?? 60_000);
    };

    // Background tab: stop polling entirely — the user isn't looking. Resume
    // with an immediate poll when the tab becomes visible again.
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } else {
        void poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) void poll();
    restartTimer();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initialAuction.id, auction.state]);

  return (
    <>
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
