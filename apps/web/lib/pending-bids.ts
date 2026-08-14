import { hashToCurve, type Proof } from "@cashu/cashu-ts";
import type { StoredProof } from "./claim";
import { swapLockedProofs } from "./claim";
import { storeProofsInWallet } from "./wallet";

export interface PendingBidEntry {
  /** Deterministic server bid id: `${auctionId}-${Ys[0..6]}-...` */
  bidId: string;
  auctionId: string;
  bidderPubkey: string;
  mintUrl: string;
  /** The committed max (full locked amount). */
  amount: number;
  /** Unix seconds after which the refund key can spend alone. */
  locktime: number;
  /** The P2PK-locked proofs (client's only copy after sendP2PK). */
  proofs: StoredProof[];
  /** Full live-bid POST body (no `mode`) — used for retry. */
  payload: string;
  status: "pending" | "live" | "outbid" | "refunded" | "unregistered";
  createdAt: number;
}

export type ReconcileStatus = "unregistered" | "live" | "refundable" | "refunded";

export interface MyBidState {
  kind: "leader" | "confirming" | "outbid" | "none";
  standingPrice?: number;
  max?: number;
}

const STORAGE_KEY = "egavel-pending-bids";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

export function computeY(secret: string): string {
  return hashToCurve(new TextEncoder().encode(secret)).toHex();
}

export function computeBidId(auctionId: string, secrets: string[]): string {
  const ys = secrets.map((s) => computeY(s));
  return `${auctionId}-${ys.map((y) => y.slice(0, 6)).join("-")}`;
}

export function buildPendingEntry(opts: {
  auctionId: string;
  bidderPubkey: string;
  mintUrl: string;
  amount: number;
  locktime: number;
  proofs: StoredProof[];
  payload: string;
}): PendingBidEntry {
  const bidId = computeBidId(opts.auctionId, opts.proofs.map((p) => p.secret));
  return { ...opts, bidId, status: "pending", createdAt: Date.now() };
}

export function loadPendingBids(): PendingBidEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PendingBidEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Upsert by bidId. */
export function savePendingBid(entry: PendingBidEntry): void {
  const rest = loadPendingBids().filter((e) => e.bidId !== entry.bidId);
  rest.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
}

export function updatePendingBidStatus(
  bidId: string,
  status: PendingBidEntry["status"],
): void {
  const all = loadPendingBids();
  const target = all.find((e) => e.bidId === bidId);
  if (!target) return;
  target.status = status;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function removePendingBid(bidId: string): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(loadPendingBids().filter((e) => e.bidId !== bidId)),
  );
}

function normalizedBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, "").replace(/\/api$/, "");
}

/**
 * Ask the server what happened to a pre-registered bundle by probing the
 * refund-data endpoint (404 = never registered; 200 = refundable now;
 * NOT_OUTBID = a live bid; ALREADY_REFUNDED = done).
 */
export async function reconcileEntry(
  entry: PendingBidEntry,
  apiBase = API_BASE,
): Promise<ReconcileStatus> {
  const base = normalizedBase(apiBase);
  const res = await fetch(
    `${base}/api/bids/${entry.bidId}/refund-data?bidder_pubkey=${entry.bidderPubkey}`,
  );
  if (res.status === 200) return "refundable";
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "NOT_OUTBID") return "live";
    if (body.error === "ALREADY_REFUNDED") return "refunded";
  }
  return "unregistered";
}

export type PlaceBidResult =
  | { ok: true; current_amount?: number }
  | { ok: false; error: string };

/**
 * Two-step submission: pre-register (`mode:"pending"`) so the server can
 * co-sign an immediate refund if the live bid fails, then submit the live bid.
 * The entry must already be persisted by the caller BEFORE calling this.
 */
export async function placeBid(params: {
  payload: Record<string, unknown>;
  entry: PendingBidEntry;
  apiBase?: string;
}): Promise<PlaceBidResult> {
  const base = normalizedBase(params.apiBase ?? API_BASE);
  try {
    // Pre-register is best-effort: a rejected or failed pre-register must not
    // prevent the live bid below (the local entry still covers recovery).
    try {
      await fetch(`${base}/api/bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params.payload, mode: "pending" }),
      });
    } catch {
      // ignore — the live bid below still proceeds
    }

    const res = await fetch(`${base}/api/bids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.payload),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: err.error ?? "bid rejected" };
    }
    updatePendingBidStatus(params.entry.bidId, "live");
    const body = (await res.json().catch(() => ({}))) as { current_amount?: number };
    return { ok: true, current_amount: body.current_amount };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function retryEntry(
  entry: PendingBidEntry,
  apiBase = API_BASE,
): Promise<PlaceBidResult> {
  return placeBid({ payload: JSON.parse(entry.payload) as Record<string, unknown>, entry, apiBase });
}

/**
 * Client-only recovery for a bundle that was never registered: after
 * `locktime` the refund key spends the P2PK lock alone (no server co-sign).
 */
export async function recoverAfterLocktime(
  entry: PendingBidEntry,
  bidderSkHex: string,
): Promise<void> {
  if (Date.now() / 1000 < entry.locktime) {
    throw new Error("locktime not reached");
  }
  const proofs = entry.proofs.map(
    (sp) =>
      ({
        id: sp.keyset_id,
        amount: sp.amount,
        secret: sp.secret,
        C: sp.C,
        mint_url: entry.mintUrl,
      }) as unknown as Proof,
  );
  const recovered = await swapLockedProofs(proofs, entry.amount, bidderSkHex);
  storeProofsInWallet(recovered, entry.mintUrl, entry.bidderPubkey);
  updatePendingBidStatus(entry.bidId, "refunded");
}

/**
 * Derive the "Your bid" status block for the auction detail page.
 * `bids` is the public verified-bid list from `/api/auctions/:id/bids`
 * (leader first); `entries` are the local pending-bids entries.
 */
export function myBidState(
  auctionId: string,
  bids: { id: string; current_amount: number; bidder_npub: string }[],
  entries: PendingBidEntry[],
  myPubkey: string | null,
): MyBidState {
  const leader = bids[0];
  if (leader && myPubkey && leader.bidder_npub === myPubkey) {
    const maxEntry = entries.find((e) => e.bidId === leader.id);
    return {
      kind: "leader",
      standingPrice: leader.current_amount,
      max: maxEntry?.amount,
    };
  }
  const mine = entries
    .filter(
      (e) => e.auctionId === auctionId && e.status !== "refunded" && e.status !== "unregistered",
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (mine?.status === "pending") return { kind: "confirming", max: mine.amount };
  if (mine) return { kind: "outbid", max: mine.amount };
  return { kind: "none" };
}
