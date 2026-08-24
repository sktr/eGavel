export const ESCROW_TIMEOUT_MS = 14 * 24 * 3600 * 1000;
export const ESCROW_TIMEOUT_SEC = 14 * 24 * 3600;

export function buildEscrowLockOptions(
  sellerXOnly: string,
  winnerXOnly: string,
  serverXOnly: string,
  locktimeSec: number,
) {
  return {
    pubkey: [sellerXOnly, winnerXOnly, serverXOnly],
    locktime: locktimeSec,
    refundKeys: [winnerXOnly],
    requiredSignatures: 2,
  } as const;
}
