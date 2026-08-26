/**
 * Coerce whatever cashu-ts's `getFeesForProofs` returned into a finite
 * number of sats. The library's return shape has drifted across versions
 * (number, string-serialized Amount, object); a naive `Number()` yields NaN,
 * which once silently zeroed the seller's proceeds and skipped escrow
 * creation (test10 incident, 2026-08-25). An unparseable value is treated
 * as 0: claims keep their protection, and an actually-unbalanced swap then
 * fails loudly at the mint instead of vanishing here.
 */
export function coerceMintFee(raw: unknown): number {
  let fee = 0;
  if (typeof raw === "number") fee = raw;
  else if (typeof raw === "bigint") fee = Number(raw);
  else if (raw) {
    const withToNumber = raw as { toNumber?: () => number };
    if (typeof withToNumber.toNumber === "function") {
      try { fee = withToNumber.toNumber(); } catch { fee = Number(String(raw)); }
    } else fee = Number(String(raw));
  } else fee = Number(String(raw ?? 0));
  if (!Number.isFinite(fee)) fee = 0;
  if (fee < 0) fee = 0;
  return fee;
}
