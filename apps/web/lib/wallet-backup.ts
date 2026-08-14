import { deserializeProofs, serializeProofs, sumProofs } from "@cashu/cashu-ts";

/**
 * Cross-device wallet backup (A: pragmatic option).
 *
 * The unspent Cashu proofs live ONLY in this browser's localStorage
 * (`cashu-wallet-v1`) — the recovery phrase restores the account key and the
 * funds locked in bids, but NOT this device's unspent balance. Export the
 * store as a versioned blob (bearer secret — whoever holds it can spend),
 * transfer it to another device, and import it there.
 */

const STORAGE_KEY = "cashu-wallet-v1";

export interface WalletBackupResult {
  mint: string;
  amount: number;
}

function loadStore(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Serialize the wallet store (per-mint serialized proof arrays). */
export function exportWalletBackup(): string {
  return JSON.stringify({ version: 1, wallets: loadStore() });
}

/**
 * Import a wallet backup: validate, merge per mint (dedupe by proof secret,
 * so re-importing is idempotent), and return the resulting per-mint amounts.
 * Throws `invalid wallet backup` for malformed input.
 */
export function importWalletBackup(text: string): WalletBackupResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid wallet backup");
  }

  const obj = parsed as { version?: number; wallets?: unknown };
  if (
    typeof obj !== "object" ||
    obj === null ||
    obj.version !== 1 ||
    typeof obj.wallets !== "object" ||
    obj.wallets === null
  ) {
    throw new Error("invalid wallet backup");
  }

  const store = loadStore();
  const results: WalletBackupResult[] = [];
  for (const [mint, raw] of Object.entries(obj.wallets as Record<string, unknown>)) {
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
      throw new Error("invalid wallet backup");
    }
    let incoming;
    try {
      incoming = deserializeProofs(raw);
    } catch {
      throw new Error("invalid wallet backup");
    }

    const existing = store[mint] ? deserializeProofs(store[mint]) : [];
    const seen = new Set(existing.map((p) => p.secret));
    const merged = [...existing];
    for (const p of incoming) {
      if (!seen.has(p.secret)) {
        seen.add(p.secret);
        merged.push(p);
      }
    }
    store[mint] = serializeProofs(merged);
    results.push({ mint, amount: Number(sumProofs(incoming)) });
  }

  saveStore(store);
  return results;
}
