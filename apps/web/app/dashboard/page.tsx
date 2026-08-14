"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useIdentity } from "../../lib/identity";
import { useWatchlist } from "../../lib/watchlist";
import { refundBid, collectChange, signSecretHex } from "../../lib/claim";
import {
  loadPendingBids,
  updatePendingBidStatus,
  removePendingBid,
  reconcileEntry,
  retryEntry,
  recoverAfterLocktime,
} from "../../lib/pending-bids";
import { bytesToHex } from "../../lib/hex";
import type { Auction, PublicBid } from "@egavel/shared";
import { ClaimPanel } from "../auctions/[id]/claim-panel";
import { BackupSection } from "../backup-section";
import { WalletPanel } from "../../components/wallet-panel";

// Root (no /api suffix) — the code below adds "/api" explicitly. This matches
// the convention in lib/claim.ts and checkout.tsx so NEXT_PUBLIC_API_URL can
// point at the Worker origin (https://egavel-api.sktr1211.workers.dev).
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

function shortId(s: string) {
  if (s.length <= 16) return s;
  return s.slice(0, 8) + "..." + s.slice(-6);
}

function timeLeft(ms: number) {
  const diff = ms - Date.now();
  if (diff <= 0) return "ended";
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return `${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// Seller view: fetch the winner's registered shipping address for a settled auction.
// API_BASE already carries the /api prefix, so it resolves to /api/auctions/:id/shipping.
// Auth = Schnorr signature over `shipping:<auctionId>` (the pubkey alone is
// public listing data — the server requires key-ownership proof).
async function loadShipping(
  auctionId: string,
  sellerPubkeyHex: string,
  sellerSkHex: string,
): Promise<{ address: string | null; note: string | null }> {
  const sellerSig = signSecretHex(`shipping:${auctionId}`, sellerSkHex);
  const res = await fetch(
    `${API_BASE}/auctions/${auctionId}/shipping?seller_pubkey=${sellerPubkeyHex}&seller_sig=${sellerSig}`,
    {
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) return { address: null, note: null };
  return res.json();
}

function statusPill(label: string, variant: "active" | "winning" | "outbid" | "won" | "pending") {
  const pal: Record<string, { bg: string; fg: string }> = {
    active: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    winning: { bg: "oklch(92% 0.04 145)", fg: "oklch(40% 0.10 145)" },
    outbid: { bg: "oklch(92% 0.04 30)", fg: "oklch(48% 0.10 30)" },
    won: { bg: "oklch(92% 0.04 145)", fg: "oklch(40% 0.10 145)" },
    pending: { bg: "var(--bg)", fg: "var(--muted)" },
  };
  const c = (pal[variant] ?? pal.pending)!;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        background: c.bg,
        color: c.fg,
      }}
    >
      {label}
    </span>
  );
}

// Thumbnails by item name (deterministic) using Material Icons
function itemThumb(name: string) {
  const icons = [
    "image",
    "palette",
    "description",
    "smart_toy",
    "checkroom",
    "bolt",
    "diamond",
    "key",
    "inventory_2",
    "music_note",
    "photo_camera",
    "watch",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return <span className="material-icons">{icons[Math.abs(hash) % icons.length]}</span>;
}

const recoverButtonStyle = {
  fontSize: 12,
  padding: "6px 14px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "var(--surface)",
  color: "var(--fg)",
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1.4,
  marginTop: 6,
};

// Refund a replaced (outbid) bid. The refund Schnorr signature must come from
// the SAME key that owns the refund path (the bidder's in-app key).
async function recoverBid(bid: PublicBid, identity: { pubkey: string; secretKey: Uint8Array }) {
  if (bid.bidder_npub !== identity.pubkey) {
    alert("this bid is not from the connected identity");
    return;
  }
  try {
    const proofs = await refundBid(bid.id, bid.bidder_npub, bytesToHex(identity.secretKey));
    alert(`Recovered ${proofs.length} proof(s) — refresh your wallet.`);
  } catch (err) {
    alert(String(err));
  }
}

// Proxy bidding: the winner locked their full MAX, but pays only the standing
// price. The excess is returned as a change output during the seller's claim —
// this collects it into the winner's wallet (1-of-1 P2PK to the winner).
function ChangeCollector({ auctionId, bidderPubkey }: { auctionId: string; bidderPubkey: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const collect = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await collectChange(auctionId, bidderPubkey);
      setStatus(`Collected ${res.amount} sats of change into your wallet`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={collect}
        disabled={busy}
        style={{
          border: "1px solid var(--accent)",
          borderRadius: "var(--radius)",
          background: "var(--accent-soft)",
          color: "var(--accent)",
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 600,
          cursor: busy ? "wait" : "pointer",
          fontFamily: "inherit",
          lineHeight: 1.4,
        }}
      >
        {busy ? "Collecting…" : "Collect change"}
      </button>
      {status && (
        <div style={{ fontSize: 11, color: "var(--accent2)", marginTop: 4 }}>{status}</div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 4 }}>
          {error === "Error: NO_CHANGE"
            ? "Nothing to collect yet — the seller hasn't claimed the auction, or your max matched the winning price."
            : error}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { identity, isLoaded } = useIdentity();
  const { ids } = useWatchlist();
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [bids, setBids] = useState<PublicBid[]>([]);
  const [auctionLookup, setAuctionLookup] = useState<Record<string, Auction>>({});
  const [watchNames, setWatchNames] = useState<Record<string, string>>({});
  const [shippingByAuction, setShippingByAuction] = useState<
    Record<string, { address: string | null; note: string | null }>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lockedFunds, setLockedFunds] = useState<ReturnType<typeof loadPendingBids>>([]);
  const [recovering, setRecovering] = useState<Record<string, boolean>>({});

  const fetchAuctionById = useCallback(async (id: string): Promise<Auction | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/auctions/${id}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<Auction>;
    } catch {
      return null;
    }
  }, []);

  // Poll auctions+bids with adaptive backoff (same pattern as live-bids.tsx)
  // so outbid statuses, standing prices and the seller view refresh on their
  // own — the dashboard used to fetch exactly once per identity change.
  useEffect(() => {
    if (!isLoaded) return;
    if (!identity) {
      // Logged out (or anonymous) — clear any previously fetched data so the
      // dashboard shows nothing from a previous account.
      setAuctions([]);
      setBids([]);
      setAuctionLookup({});
      setShippingByAuction({});
      setError("Identity not available — Connect to view your dashboard.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastJson = "";
    const BACKOFF_LEVELS = [4000, 10_000, 30_000, 60_000];
    let level = 0;

    const fetchData = async (silent: boolean) => {
      // SEC-2: /bids requires a Schnorr signature over `bids:<pubkey>` so a
      // third party cannot read another user's bid history.
      const bidderSig = signSecretHex(`bids:${identity.pubkey}`, bytesToHex(identity.secretKey));
      const [auctionsRes, bidsRes] = await Promise.all([
        fetch(`${API_BASE}/api/auctions?seller_pubkey=${identity.pubkey}`, {
          signal: AbortSignal.timeout(10000),
        }),
        fetch(`${API_BASE}/api/bids?bidder_pubkey=${identity.pubkey}&bidder_sig=${bidderSig}`, {
          signal: AbortSignal.timeout(10000),
        }),
      ]);

      if (!auctionsRes.ok) throw new Error(`auctions: ${auctionsRes.status}`);
      if (!bidsRes.ok) throw new Error(`bids: ${bidsRes.status}`);

      const fetchedAuctions: Auction[] = await auctionsRes.json();
      const fetchedBids: PublicBid[] = await bidsRes.json();

      const signature = JSON.stringify({ auctions: fetchedAuctions, bids: fetchedBids });
      if (signature === lastJson) {
        // Nothing changed — back off (capped at the slowest level).
        level = Math.min(level + 1, BACKOFF_LEVELS.length - 1);
        return;
      }
      lastJson = signature;
      level = 0; // something changed — poll fast again

      if (cancelled) return;
      setAuctions(fetchedAuctions);
      setBids(fetchedBids);

      // Build lookup for auctions referenced by bids
      const lookup: Record<string, Auction> = {};
      for (const a of fetchedAuctions) {
        lookup[a.id] = a;
      }
      // Fetch any missing auctions from bids
      const missingIds = [...new Set(fetchedBids.map((b) => b.auction_id))].filter(
        (id) => !lookup[id],
      );
      if (missingIds.length > 0) {
        const fetched = await Promise.all(missingIds.map(fetchAuctionById));
        for (const a of fetched) {
          if (cancelled) return;
          if (a) lookup[a.id] = a;
        }
      }
      setAuctionLookup(lookup);
      if (silent) setError(null);
    };

    const poll = async (silent: boolean) => {
      try {
        await fetchData(silent);
      } catch (err) {
        // Transient network error — keep the last good data. Only the first
        // load surfaces an error banner.
        if (silent) {
          // back off a little extra on errors, then keep trying
          level = Math.min(level + 1, BACKOFF_LEVELS.length - 1);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled && !document.hidden) restartTimer();
      }
    };

    const restartTimer = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => void poll(true), BACKOFF_LEVELS[level] ?? 60_000);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } else {
        void poll(true);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void poll(false).finally(() => {
      if (!cancelled) setLoading(false);
    });
    restartTimer();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [identity, isLoaded, fetchAuctionById]);

  // Resolve watchlist ids to auction item names (ids are 64-char hex; show the
  // item name instead, with the id as the link).
  useEffect(() => {
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const names: Record<string, string> = {};
      for (const id of ids) {
        if (cancelled) return;
        const a = await fetchAuctionById(id);
        if (a) names[id] = a.item;
      }
      if (!cancelled) setWatchNames(names);
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, fetchAuctionById]);

  // Seller view: fetch shipping addresses for settled listings the user sold
  useEffect(() => {
    if (!identity) return;
    const settledListings = auctions.filter(
      (a) => a.state === "SETTLED" && a.seller_pubkey === identity.pubkey && a.winner_npub,
    );
    if (settledListings.length === 0) {
      setShippingByAuction({});
      return;
    }
    let cancelled = false;
    (async () => {
      const map: Record<string, { address: string | null; note: string | null }> = {};
      for (const a of settledListings) {
        map[a.id] = await loadShipping(a.id, identity.pubkey, bytesToHex(identity.secretKey));
      }
      if (!cancelled) setShippingByAuction(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, auctions]);

  // Auto-refund outbid bids: when a bid is no longer the highest, the funds
  // return immediately via bidder+server co-sign (2-of-3, spec §6.4).
  // Failed refunds are retried every 5 minutes (transient mint/network
  // failures self-heal). The set is a retry throttle, not a blacklist.
  const failedRefundsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!identity) return;
    const skHex = bytesToHex(identity.secretKey);
    let cancelled = false;
    const run = async () => {
      for (const b of bids) {
        if (cancelled) return;
        if (b.status !== "outbid") continue;
        if (failedRefundsRef.current.has(b.id)) continue;
        try {
          await refundBid(b.id, b.bidder_npub, skHex);
          // Keep the local entry / Locked Funds section consistent.
          updatePendingBidStatus(b.id, "refunded");
          removePendingBid(b.id);
          setLockedFunds((l) => l.filter((x) => x.bidId !== b.id));
        } catch {
          failedRefundsRef.current.add(b.id);
        }
      }
    };
    run();
    const timer = setInterval(run, 15000);
    const retryTimer = setInterval(() => {
      failedRefundsRef.current.clear();
    }, 300_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(retryTimer);
    };
  }, [bids, identity]);

  // Reconcile local pending-bid entries against the server on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = loadPendingBids();
      if (entries.length === 0) return;
      const out: typeof entries = [];
      for (const e of entries) {
        let st: Awaited<ReturnType<typeof reconcileEntry>>;
        try {
          st = await reconcileEntry(e);
        } catch {
          // A flaky/offline probe must not hide the whole Locked Funds section:
          // keep the entry as-is (its stored status) and move on to the next.
          out.push(e);
          continue;
        }
        if (cancelled) return;
        if (st === "live") {
          updatePendingBidStatus(e.bidId, "live");
          out.push({ ...e, status: "live" });
        } else if (st === "refunded") {
          removePendingBid(e.bidId);
        } else if (st === "refundable") {
          // registered as pending or outbid — refundable via refundBid
          updatePendingBidStatus(e.bidId, "outbid");
          out.push({ ...e, status: "outbid" });
        } else {
          // unregistered — retry or locktime recovery; persist the status so
          // the "unregistered" action row (Retry / Recover after locktime) renders
          updatePendingBidStatus(e.bidId, "unregistered");
          out.push({ ...e, status: "unregistered" });
        }
      }
      setLockedFunds(out);
    })().catch(() => {
      // Never surface an unhandled rejection from the reconcile loop.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRetryLocked = useCallback(async (e: (typeof lockedFunds)[number]) => {
    setRecovering((r) => ({ ...r, [e.bidId]: true }));
    try {
      const result = await retryEntry(e);
      if (result.ok) {
        updatePendingBidStatus(e.bidId, "live");
        setLockedFunds((l) => l.map((x) => (x.bidId === e.bidId ? { ...x, status: "live" } : x)));
      } else {
        window.alert(`retry failed: ${result.error}`);
      }
    } finally {
      setRecovering((r) => ({ ...r, [e.bidId]: false }));
    }
  }, []);

  const handleRefundLocked = useCallback(async (e: (typeof lockedFunds)[number]) => {
    if (!identity) return;
    setRecovering((r) => ({ ...r, [e.bidId]: true }));
    try {
      await refundBid(e.bidId, e.bidderPubkey, bytesToHex(identity.secretKey));
      updatePendingBidStatus(e.bidId, "refunded");
      removePendingBid(e.bidId);
      setLockedFunds((l) => l.filter((x) => x.bidId !== e.bidId));
    } catch (err) {
      window.alert(`refund failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecovering((r) => ({ ...r, [e.bidId]: false }));
    }
  }, [identity]);

  const handleRecoverLocked = useCallback(async (e: (typeof lockedFunds)[number]) => {
    if (!identity) return;
    setRecovering((r) => ({ ...r, [e.bidId]: true }));
    try {
      await recoverAfterLocktime(e, bytesToHex(identity.secretKey));
      updatePendingBidStatus(e.bidId, "refunded");
      removePendingBid(e.bidId);
      setLockedFunds((l) => l.filter((x) => x.bidId !== e.bidId));
    } catch (err) {
      window.alert(`recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecovering((r) => ({ ...r, [e.bidId]: false }));
    }
  }, [identity]);

  if (!isLoaded || loading) {
    return (
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "4rem 24px",
          textAlign: "center",
          color: "var(--muted)",
        }}
      >
        Loading dashboard…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "4rem 24px" }}>
        <div style={{ padding: "40px 0 32px" }}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "clamp(28px, 4vw, 36px)",
              letterSpacing: "-0.02em",
              marginBottom: 8,
            }}
          >
            Dashboard
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
            An error occurred while loading the dashboard.
          </p>
        </div>
        <p style={{ color: "var(--red)" }}>{error}</p>
      </div>
    );
  }

  // Compute stats
  const activeListings = auctions.filter((a) => a.state === "ACTIVE" || a.state === "EXTENDED");
  const activeBids = bids.filter((b) => {
    const auction = auctionLookup[b.auction_id];
    return auction && (auction.state === "ACTIVE" || auction.state === "EXTENDED");
  });
  const wonAuctions = auctions.filter(
    (a) => a.state === "SETTLED" && a.winner_npub === identity?.pubkey,
  );
  const totalSpent = wonAuctions.reduce((sum, a) => sum + (a.winning_amount ?? 0), 0);

  // Settled listings the user sold to a winner (seller view → shipping address)
  const settledListings = auctions.filter(
    (a) => a.state === "SETTLED" && a.seller_pubkey === identity?.pubkey && a.winner_npub,
  );

  // Winning bids: bids on auctions where the user is the winner
  const wonBids = bids.filter((b) => {
    const auction = auctionLookup[b.auction_id];
    return auction && auction.state === "SETTLED" && auction.winner_npub === identity?.pubkey;
  });

  // Auctions I won but where my bid matches winning amount
  const wonViaBid = wonBids.length > 0;
  // Combined claimable items (seller view: settled listings with a winner)
  const claimable = settledListings.length;

  // Info for bid cards: determine status
  function bidStatus(b: PublicBid): {
    label: string;
    variant: "winning" | "outbid" | "won" | "pending";
  } {
    const auction = auctionLookup[b.auction_id];
    if (!auction) return { label: "Pending", variant: "outbid" };
    if (b.status === "pending") {
      return { label: "Confirming", variant: "pending" };
    }
    if (auction.state === "SETTLED") {
      // The winner's bid stays status "verified" — with proxy bidding the
      // max never equals the winning price, so match on status, not amount.
      if (auction.winner_npub === identity?.pubkey && b.status === "verified") {
        return { label: "Won", variant: "won" };
      }
      return { label: "Ended", variant: "outbid" };
    }
    // Still active — check if it's the current highest
    if (b.status === "verified") {
      return { label: "Winning", variant: "winning" };
    }
    return { label: "Outbid", variant: "outbid" };
  }

  // Generate activity feed items from available data
  const activityItems: Array<{ icon: string; text: string; time: string }> = [];
  // Recent bid activities
  for (const b of activeBids.slice(-3).reverse()) {
    const a = auctionLookup[b.auction_id];
    if (a) {
      const st = bidStatus(b);
      activityItems.push({
        icon: "notifications",
        text: `Placed bid on "${a.item}" (${b.current_amount.toLocaleString()} sats)`,
        time: timeLeft(a.end_time),
      });
    }
  }
  // Won activities
  for (const a of wonAuctions.slice(0, 2)) {
    activityItems.push({
      icon: "emoji_events",
      text: `Won "${a.item}" (${(a.winning_amount ?? 0).toLocaleString()} sats)`,
      time: "Closed",
    });
  }
  // Listed activities
  for (const a of activeListings.slice(0, 2)) {
    activityItems.push({
      icon: "ios_share",
      text: `Listed "${a.item}"`,
      time: timeLeft(a.end_time),
    });
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* ===== Page Header ===== */}
      <div style={{ paddingTop: 40, marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(22px, 2.5vw, 28px)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Dashboard
        </h1>
      </div>

      {/* ===== Profile Card ===== */}
      <div
        style={{
          display: "flex",
          gap: 24,
          alignItems: "center",
          padding: 24,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          marginBottom: 40,
          flexWrap: "wrap",
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "#f3f4f6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          {identity?.pubkey ? identity.pubkey.charAt(0).toUpperCase() : "?"}
        </div>
        {/* Info */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {identity?.pubkey ? shortId(identity.pubkey) : "User"}
          </div>
        </div>
        {/* Stats */}
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {activeBids.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Bidding</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {wonAuctions.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Won</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {activeListings.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Listed</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {ids.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Watching</div>
          </div>
        </div>
      </div>

      {/* ===== Account Backup (recovery phrase) ===== */}
      <WalletPanel />

      <BackupSection />

      {/* ===== Watching ===== */}
      {ids.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Watching</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {ids.map((id) => (
              <li
                key={id}
                style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}
              >
                <a
                  href={`/auctions/${id}`}
                  style={{
                    color: "var(--fg)",
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 500,
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {watchNames[id] ?? `Auction ${shortId(id)}`}
                </a>
                <span
                  style={{
                    color: "var(--muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    display: "block",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {id}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ===== Locked Funds ===== */}
      {lockedFunds.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 16 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Locked Funds
            </h2>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0 16px", marginBottom: 24 }}>
            {lockedFunds.map((e) => (
              <div key={e.bidId} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {e.amount.toLocaleString()} sats
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {e.status === "live" ? "Live bid" : e.status === "outbid" ? "Refundable" : e.status === "pending" ? "Confirming" : "Not registered"}
                </span>
                {e.status === "unregistered" && (
                  <>
                    <button type="button" onClick={() => handleRetryLocked(e)} disabled={recovering[e.bidId]} style={{ padding: "4px 12px", fontSize: 12, borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", cursor: "pointer" }}>
                      {recovering[e.bidId] ? "Retrying…" : "Retry bid"}
                    </button>
                    {Date.now() / 1000 >= e.locktime && (
                      <button type="button" onClick={() => handleRecoverLocked(e)} disabled={recovering[e.bidId]} style={{ padding: "4px 12px", fontSize: 12, borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--red)", cursor: "pointer" }}>
                        Recover after locktime
                      </button>
                    )}
                  </>
                )}
                {(e.status === "outbid" || e.status === "pending") && (
                  <button type="button" onClick={() => handleRefundLocked(e)} disabled={recovering[e.bidId]} style={{ padding: "4px 12px", fontSize: 12, borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--red)", cursor: "pointer" }}>
                    {recovering[e.bidId] ? "Refunding…" : "Refund now"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== Active Bids ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Active Bids
        </h2>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0 16px",
          marginBottom: 24,
        }}
      >
        {activeBids.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14, padding: "16px 0" }}>
            No active bids.
            <a href="/" style={{ color: "var(--accent)", marginLeft: 4 }}>
              Browse items
            </a>
          </p>
        )}

        {activeBids.map((b, idx) => {
          const auction = auctionLookup[b.auction_id];
          const st = bidStatus(b);
          // refund is only possible after locktime (end_time + 24h) — spec §2.2
          const recoverable =
            b.status === "outbid" &&
            auction !== undefined &&
            Date.now() > auction.end_time + 24 * 60 * 60 * 1000;
          const rowStyle = {
            display: "grid",
            gridTemplateColumns: "56px 1fr auto",
            gap: 16,
            alignItems: "center",
            padding: "8px 0",
            borderBottom: idx < activeBids.length - 1 ? "1px solid var(--border)" : "none",
          };
          const row = (
            <>
              {/* Thumbnail */}
              <div
                style={{
                  width: 56,
                  height: 42,
                  background:
                    st.variant === "winning"
                      ? "oklch(90% 0.06 145)"
                      : st.variant === "outbid"
                        ? "oklch(90% 0.04 30)"
                        : "#f3f4f6",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {itemThumb(auction?.item ?? "item")}
              </div>
              {/* Info */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {auction?.item ?? `Auction ${shortId(b.auction_id)}`}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {statusPill(st.label, st.variant)}
                  {auction && (auction.state === "ACTIVE" || auction.state === "EXTENDED") && (
                    <span>{timeLeft(auction.end_time)}</span>
                  )}
                </div>
              </div>
              {/* Status + Price */}
              <div style={{ textAlign: "right", fontSize: 13 }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    fontSize: 14,
                    color:
                      st.variant === "winning"
                        ? "var(--accent2)"
                        : st.variant === "won"
                          ? "var(--accent2)"
                          : "var(--fg)",
                  }}
                >
                  {b.current_amount.toLocaleString()} sats
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {st.label === "Winning"
                    ? "Highest Bidder"
                    : st.label === "Outbid"
                      ? "Bidding"
                      : st.label}
                </div>
                {b.status === "outbid" && auction && !recoverable && (
                  <div style={{ fontSize: 11, color: "var(--amber)" }}>Outbid — refunding…</div>
                )}
                {recoverable && (
                  <button
                    type="button"
                    onClick={() => recoverBid(b, identity!)}
                    style={recoverButtonStyle}
                  >
                    Recover
                  </button>
                )}
              </div>
            </>
          );
          if (recoverable) {
            return (
              <div key={b.id} className="resp-grid-row" style={rowStyle}>
                {row}
              </div>
            );
          }
          return (
            <a
              key={b.id}
              href={`/auctions/${b.auction_id}`}
              className="resp-grid-row"
              style={{ ...rowStyle, color: "inherit", textDecoration: "none" }}
            >
              {row}
            </a>
          );
        })}

        {/* Settled/won bids (under Active Bids) */}
        {bids.filter((b) => {
          const a = auctionLookup[b.auction_id];
          return a && a.state === "SETTLED";
        }).length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
            {bids
              .filter((b) => {
                const a = auctionLookup[b.auction_id];
                return a && a.state === "SETTLED";
              })
              .map((b, idx, arr) => {
                const auction = auctionLookup[b.auction_id];
                const isWinner =
                  auction?.winner_npub === identity?.pubkey && b.status === "verified"; // proxy bidding: max ≠ winning price
                // refund is only possible after locktime (end_time + 24h) — spec §2.2
                const recoverable =
                  !isWinner &&
                  b.status === "outbid" &&
                  auction !== undefined &&
                  Date.now() > auction.end_time + 24 * 60 * 60 * 1000;
                const rowStyle = {
                  display: "grid",
                  gridTemplateColumns: "56px 1fr auto",
                  gap: 16,
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: idx < arr.length - 1 ? "1px solid var(--border)" : "none",
                  opacity: isWinner ? 1 : 0.7,
                };
                const row = (
                  <>
                    <div
                      style={{
                        width: 56,
                        height: 42,
                        background: isWinner ? "oklch(92% 0.04 145)" : "#f3f4f6",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        flexShrink: 0,
                      }}
                    >
                      {itemThumb(auction?.item ?? "item")}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {auction?.item ?? `Auction ${shortId(b.auction_id)}`}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginTop: 2,
                        }}
                      >
                        {statusPill(isWinner ? "Won" : "Ended", isWinner ? "won" : "outbid")}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 13 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontWeight: 600,
                          fontSize: 14,
                        }}
                      >
                        {(isWinner
                          ? (auction?.winning_amount ?? b.current_amount)
                          : b.current_amount
                        ).toLocaleString()}{" "}
                        sats
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {isWinner ? "Winning Price" : "Bid"}
                      </div>
                      {b.status === "outbid" && auction && !recoverable && (
                        <div style={{ fontSize: 11, color: "var(--amber)" }}>
                          Outbid — refunding…
                        </div>
                      )}
                      {recoverable && (
                        <button
                          type="button"
                          onClick={() => recoverBid(b, identity!)}
                          style={recoverButtonStyle}
                        >
                          Recover
                        </button>
                      )}
                      {isWinner && identity && (
                        <ChangeCollector auctionId={b.auction_id} bidderPubkey={identity.pubkey} />
                      )}
                    </div>
                  </>
                );
                if (recoverable) {
                  return (
                    <div key={b.id} className="resp-grid-row" style={rowStyle}>
                      {row}
                    </div>
                  );
                }
                return (
                  <a
                    key={b.id}
                    href={`/auctions/${b.auction_id}`}
                    className="resp-grid-row"
                    style={{ ...rowStyle, color: "inherit", textDecoration: "none" }}
                  >
                    {row}
                  </a>
                );
              })}
          </div>
        )}
      </div>

      {/* ===== My Listings ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          My Listings
        </h2>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0 16px",
          marginBottom: 24,
        }}
      >
        {activeListings.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14, padding: "16px 0" }}>
            No active listings.
            <a href="/create" style={{ color: "var(--accent)", marginLeft: 4 }}>
              Create Listing
            </a>
          </p>
        )}

        {activeListings.map((a, idx) => {
          const bidCount = bids.filter((b) => b.auction_id === a.id).length;
          return (
            <a
              key={a.id}
              href={`/auctions/${a.id}`}
              className="resp-grid-row"
              style={{
                display: "grid",
                gridTemplateColumns: "56px 1fr auto",
                gap: 16,
                alignItems: "center",
                padding: "8px 0",
                borderBottom: idx < activeListings.length - 1 ? "1px solid var(--border)" : "none",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 42,
                  background: "#f3f4f6",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {itemThumb(a.item)}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{a.item}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {statusPill("Active", "active")}
                  <span>{timeLeft(a.end_time)}</span>
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 13 }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  {a.start_price.toLocaleString()} sats
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{bidCount} bids</div>
              </div>
            </a>
          );
        })}
      </div>

      {/* ===== Sold — Shipping (seller view) ===== */}
      {settledListings.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 24,
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 17,
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              Sold — Shipping
            </h2>
          </div>

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "0 16px",
            }}
          >
            {settledListings.map((a, idx) => {
              const sh = shippingByAuction[a.id];
              return (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 16,
                    padding: "12px 0",
                    borderBottom:
                      idx < settledListings.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <a
                      href={`/auctions/${a.id}`}
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "inherit",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "block",
                      }}
                    >
                      {a.item}
                    </a>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      Winner: {shortId(a.winner_npub ?? "")} — {a.winning_amount?.toLocaleString()}{" "}
                      sats
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 13, maxWidth: "50%" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>Shipping</div>
                    <div
                      style={{
                        fontWeight: 500,
                        wordBreak: "break-all",
                      }}
                    >
                      {sh?.address ?? "—"}
                    </div>
                    {sh?.note && (
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>Note: {sh.note}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== Watchlist ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Watchlist
        </h2>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {wonAuctions.length === 0 && activeListings.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14, gridColumn: "1 / -1" }}>
            No watched items yet.
          </p>
        )}

        {/* Show settled auctions as watchlist cards */}
        {wonAuctions.slice(0, 6).map((a) => (
          <a
            key={a.id}
            href={`/auctions/${a.id}`}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <div
              style={{
                aspectRatio: "4 / 3",
                background: "#f3f4f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 24,
              }}
            >
              {itemThumb(a.item)}
            </div>
            <div style={{ padding: "8px 12px 12px" }}>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginBottom: 4,
                }}
              >
                {a.item}
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--fg)",
                    fontSize: 13,
                  }}
                >
                  {a.winning_amount?.toLocaleString() ?? a.start_price.toLocaleString()} sats
                </span>
                <span>Won</span>
              </div>
            </div>
          </a>
        ))}
        {/* If no won auctions, show active listings */}
        {wonAuctions.length === 0 &&
          activeListings.slice(0, 6).map((a) => (
            <a
              key={a.id}
              href={`/auctions/${a.id}`}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div
                style={{
                  aspectRatio: "4 / 3",
                  background: "#f3f4f6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--muted)",
                  fontSize: 24,
                }}
              >
                {itemThumb(a.item)}
              </div>
              <div style={{ padding: "8px 12px 12px" }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginBottom: 4,
                  }}
                >
                  {a.item}
                </div>
                <div
                  style={{
                    color: "var(--muted)",
                    fontSize: 12,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontFamily: "var(--font-mono)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--fg)",
                      fontSize: 13,
                    }}
                  >
                    {a.start_price.toLocaleString()} sats
                  </span>
                  <span>{timeLeft(a.end_time)}</span>
                </div>
              </div>
            </a>
          ))}
      </div>

      {/* ===== Recent Activity ===== */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Recent Activity
        </h2>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "4px 16px",
          marginBottom: 24,
        }}
      >
        {activityItems.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14, padding: "12px 0" }}>
            No recent activity.
          </p>
        ) : (
          activityItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                gap: 16,
                padding: "8px 0",
                alignItems: "center",
                borderBottom: idx < activityItems.length - 1 ? "1px solid var(--border)" : "none",
                fontSize: 13,
              }}
            >
              <span
                className="material-icons"
                style={{ width: 20, textAlign: "center", color: "var(--muted)", fontSize: 16 }}
              >
                {item.icon}
              </span>
              <span style={{ flex: 1 }}>{item.text}</span>
              <span
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {item.time}
              </span>
            </div>
          ))
        )}
      </div>

      {/* ===== Ready to Claim (seller view) ===== */}
      {claimable > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              marginBottom: 16,
            }}
          >
            Ready to Claim
          </h2>

          {settledListings.map((a) => (
            <div
              key={a.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "16px",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div>
                  <a
                    href={`/auctions/${a.id}`}
                    style={{
                      color: "inherit",
                      fontWeight: 600,
                      fontSize: 14,
                      textDecoration: "none",
                    }}
                  >
                    {a.item}
                  </a>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      marginTop: 2,
                    }}
                  >
                    Winner: {shortId(a.winner_npub ?? "")} — {a.winning_amount?.toLocaleString()}{" "}
                    sats
                  </div>
                </div>
                {statusPill("Settled", "won")}
              </div>
              <ClaimPanel auction={a} isSeller={true} isWinner={false} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
