import { collectChange } from "./claim";

/**
 * Auto-collection of the winner's change (proxy-bidding excess).
 *
 * The change output only exists after the seller's claim swap, so collection is
 * a poll loop on the dashboard: for every won (verified) bid on a SETTLED
 * auction, fetch `GET /auctions/:id/change` and store the 1-of-1 P2PK proofs
 * into the wallet. Outcomes are classified so the loop can stop where it is
 * futile (NO_CHANGE = claimed but max == winning price) and retry where the
 * output may still appear (NOT_CLAIMED = seller has not claimed yet).
 */

export type CollectOutcome =
  | { kind: "collected"; auctionId: string; amount: number }
  | { kind: "not-claimed"; auctionId: string }
  | { kind: "no-change"; auctionId: string }
  | { kind: "error"; auctionId: string; message: string };

/** Which auctions need change collection: my verified bid on a SETTLED
 * auction where I am the winner. Pure selection — no I/O. */
export function collectibleChangeAuctions(
  bids: { auction_id: string; status: string }[],
  auctions: Record<string, { state: string; winner_npub: string | null }>,
  pubkey: string,
): string[] {
  const ids = new Set<string>();
  for (const b of bids) {
    if (b.status !== "verified") continue;
    const a = auctions[b.auction_id];
    if (!a || a.state !== "SETTLED" || a.winner_npub !== pubkey) continue;
    ids.add(b.auction_id);
  }
  return [...ids];
}

/** Attempt collection for a single auction and classify the outcome. */
export async function tryCollectChange(
  auctionId: string,
  bidderPubkey: string,
  bidderSkHex: string,
): Promise<CollectOutcome> {
  try {
    const res = await collectChange(auctionId, bidderPubkey, bidderSkHex);
    return { kind: "collected", auctionId, amount: res.amount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NOT_CLAIMED")) return { kind: "not-claimed", auctionId };
    if (msg.includes("NO_CHANGE")) return { kind: "no-change", auctionId };
    return { kind: "error", auctionId, message: msg };
  }
}

/** Collect change for a batch of auctions (the poll-loop body). */
export async function autoCollectChange(
  auctionIds: string[],
  bidderPubkey: string,
  bidderSkHex: string,
): Promise<CollectOutcome[]> {
  const outcomes: CollectOutcome[] = [];
  for (const id of auctionIds) {
    outcomes.push(await tryCollectChange(id, bidderPubkey, bidderSkHex));
  }
  return outcomes;
}

// ── Handled-set persistence ──────────────────────────────────────────────
// Auctions where collection is *done* (collected or permanently NO_CHANGE)
// are remembered per pubkey so the poll loop stops asking about them. A
// server-side flag would break multi-device collection, so this is purely
// client-side (each device collects into its own wallet store).
const HANDLED_KEY_PREFIX = "egavel:handled-change";

export function loadHandledChange(pubkey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${HANDLED_KEY_PREFIX}:${pubkey}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveHandledChange(pubkey: string, handled: Set<string>) {
  try {
    localStorage.setItem(`${HANDLED_KEY_PREFIX}:${pubkey}`, JSON.stringify([...handled]));
  } catch {
    // localStorage unavailable — the in-memory set still throttles this session.
  }
}
