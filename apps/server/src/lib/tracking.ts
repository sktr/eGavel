// apps/server/src/lib/tracking.ts
export type TrackingKind = "s10" | "ups" | "fedex" | "dhl";

const S10_RE = /^([A-Z]{2})(\d{8})(\d)([A-Z]{2})$/;
const UPS_RE = /^1Z[0-9A-Z]{16}$/;
const FEDEX_12_RE = /^\d{12}$/;
const FEDEX_15_RE = /^\d{15}$/;
const DHL_RE = /^\d{10}$/;

const S10_WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7] as const;

function s10CheckDigit(serial8: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(serial8[i]!) * S10_WEIGHTS[i]!;
  const r = sum % 11;
  const c = 11 - r;
  if (c === 10) return 0;
  if (c === 11) return 5;
  return c;
}

function isValidS10(s: string): boolean {
  const up = s.toUpperCase();
  const m = S10_RE.exec(up);
  if (!m) return false;
  const serial = m[2]!;
  const check = Number(m[3]);
  return s10CheckDigit(serial) === check;
}

export function validateTracking(input: string): { kind: TrackingKind } | null {
  const s = input.trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (isValidS10(s)) return { kind: "s10" };
  if (UPS_RE.test(up)) return { kind: "ups" };
  if (FEDEX_12_RE.test(s) || FEDEX_15_RE.test(s)) return { kind: "fedex" };
  if (DHL_RE.test(s)) return { kind: "dhl" };
  return null;
}
