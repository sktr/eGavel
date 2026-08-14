import { Wallet, type CounterSource } from "@cashu/cashu-ts";
import { mnemonicToSeedSync } from "@scure/bip39";
import { loadAccount } from "./key-store";

/**
 * NUT-13 deterministic wallet: the account's BIP-39 phrase derives every new
 * ecash output (secret + blinding factor), so the mint's NUT-09 restore
 * endpoint can re-issue the tokens after a device loss. The per-keyset
 * counter is persisted per account so recovery scans line up with creation.
 */

function counterStorageKey(pubkey: string): string {
  return `egavel-wallet-counters:${pubkey}`;
}

function loadCounters(pubkey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(counterStorageKey(pubkey));
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveCounters(pubkey: string, counters: Record<string, number>) {
  localStorage.setItem(counterStorageKey(pubkey), JSON.stringify(counters));
}

/** localStorage-backed CounterSource, namespaced per account pubkey. */
export function createCounterSource(pubkey: string): CounterSource {
  return {
    async reserve(keysetId: string, n: number) {
      const counters = loadCounters(pubkey);
      const next = counters[keysetId] ?? 0;
      if (n === 0) return { start: next, count: 0 }; // peek — no mutation
      counters[keysetId] = next + n;
      saveCounters(pubkey, counters);
      return { start: next, count: n };
    },
    async advanceToAtLeast(keysetId: string, minNext: number) {
      const counters = loadCounters(pubkey);
      const next = counters[keysetId] ?? 0;
      if (next < minNext) {
        counters[keysetId] = minNext;
        saveCounters(pubkey, counters);
      }
    },
    async snapshot() {
      return loadCounters(pubkey);
    },
    async setNext(keysetId: string, next: number) {
      const counters = loadCounters(pubkey);
      counters[keysetId] = next;
      saveCounters(pubkey, counters);
    },
  };
}

export type WalletBuildOptions =
  | { unit: "sat" }
  | { unit: "sat"; bip39seed: Uint8Array; counterSource: CounterSource };

/**
 * Pure option builder: with a recovery phrase the wallet derives secrets
 * deterministically (NUT-13); legacy hex-key accounts get a plain wallet.
 */
export function walletOptions(mintUrl: string): WalletBuildOptions {
  const account = loadAccount();
  if (!account?.words) return { unit: "sat" };
  const bip39seed = mnemonicToSeedSync(account.words);
  return { unit: "sat", bip39seed, counterSource: createCounterSource(account.pubkey) };
}

/** Shared constructor — every output-creating site must use this. */
export function buildWallet(mintUrl: string): Wallet {
  return new Wallet(mintUrl, walletOptions(mintUrl));
}
