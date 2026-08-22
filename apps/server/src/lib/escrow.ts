export const STAGE1_LOCKTIME_SEC = 10 * 24 * 3600;
export const STAGE2_LOCKTIME_SEC = 30 * 24 * 3600;
export const WINNER_FALLBACK_MS = 72 * 3600 * 1000;
export const TRACKING_CUTOFF_MS = 24 * 3600 * 1000;
export type EscrowMode = "two-stage" | "legacy";
export type EscrowStatus = "active" | "migrating" | "confirmed" | "refunded_winner" | "swept_seller" | "split_resolved";
export function resolveEscrowMode(v?: string): EscrowMode {
  return v === "legacy" ? "legacy" : "two-stage";
}
export function buildStage1LockOptions(sellerXOnly: string, winnerXOnly: string, serverXOnly: string, locktimeSec: number) {
  return { pubkey: [sellerXOnly, winnerXOnly, serverXOnly], locktime: locktimeSec, refundKeys: [winnerXOnly], requiredSignatures: 2 };
}
export function buildStage2LockOptions(sellerXOnly: string, winnerXOnly: string, serverXOnly: string, locktimeSec: number) {
  return { pubkey: [sellerXOnly, winnerXOnly, serverXOnly], locktime: locktimeSec, refundKeys: [sellerXOnly], requiredSignatures: 2 };
}
