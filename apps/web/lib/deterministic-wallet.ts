import {
  Wallet,
  deserializeProofs,
  type CounterSource,
  type Proof,
} from "@cashu/cashu-ts";
import { mnemonicToSeedSync } from "@scure/bip39";
import { deriveAccountFromWords, loadAccount } from "./key-store";
import { storeProofsInWallet } from "./wallet";
import { DEFAULT_MINT } from "./config";

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

/**
 * After NUT-13 recovery the account's persistent counter source must not
 * re-derive outputs from counters the restore already consumed. Bump each
 * keyset's cursor past the last counter with a signature so the next mint
 * starts fresh. Keysets with no restored range (counter undefined) are left
 * untouched.
 */
export async function advanceCountersPastRecovery(
  pubkey: string,
  keysetCounters: Record<string, number | undefined>,
): Promise<void> {
  const source = createCounterSource(pubkey);
  for (const [keysetId, counter] of Object.entries(keysetCounters)) {
    if (counter === undefined) continue;
    await source.advanceToAtLeast(keysetId, counter + 1);
  }
}

/**
 * Drop proofs whose secret is already present in the wallet store for the
 * mint. Without this, running recovery twice (or recovering onto a device
 * that already holds the balance) would duplicate tokens.
 */
export function filterNewProofs(mintUrl: string, proofs: Proof[]): Proof[] {
  let store: Record<string, string[]> = {};
  try {
    store = JSON.parse(
      localStorage.getItem("cashu-wallet-v1") ?? "{}",
    ) as Record<string, string[]>;
  } catch {
    store = {};
  }
  const existing = deserializeProofs(store[mintUrl] ?? []);
  const seen = new Set(existing.map((p) => p.secret));
  return proofs.filter((p) => !seen.has(p.secret));
}

export type WalletBuildOptions =
  | { unit: "sat" }
  | { unit: "sat"; bip39seed: Uint8Array; counterSource: CounterSource };

/**
 * Pure option builder: with a recovery phrase the wallet derives secrets
 * deterministically (NUT-13); legacy hex-key accounts get a plain wallet.
 */
export function walletOptions(_mintUrl: string): WalletBuildOptions {
  const account = loadAccount();
  if (!account?.words) return { unit: "sat" };
  const bip39seed = mnemonicToSeedSync(account.words);
  return { unit: "sat", bip39seed, counterSource: createCounterSource(account.pubkey) };
}

/** Shared constructor — every output-creating site must use this. */
export function buildWallet(mintUrl: string): Wallet {
  return new Wallet(mintUrl, walletOptions(mintUrl));
}

export interface RecoverResult {
  mint: string;
  recovered: number;
}

/**
 * NUT-13 recovery: regenerate deterministic proofs for each mint+keyset via
 * the mint's NUT-09 restore endpoint, drop spent proofs (NUT-07), and merge
 * the unspent balance into the wallet store. Never throws — per-mint failures
 * are reported as recovered: 0.
 */
export async function recoverBalanceFromSeed(opts: {
  mnemonic: string;
  mintUrls: string[];
  onProgress?: (msg: string) => void;
}): Promise<RecoverResult[]> {
  const { mnemonic, mintUrls, onProgress } = opts;
  const seed = mnemonicToSeedSync(mnemonic);
  const results: RecoverResult[] = [];

  for (const mintUrl of mintUrls) {
    try {
      const wallet = new Wallet(mintUrl, {
        unit: "sat",
        bip39seed: seed,
        // No counterSource: batchRestore derives from explicit counters; the
        // wallet's own persistent source is only for future mints.
      });
      await wallet.loadMint();
      const keysets = await fetch(`${mintUrl}/v1/keysets`)
        .then((r) => r.json())
        .then((d: { keysets: { id: string }[] }) => d.keysets ?? []);
      if (keysets.length === 0) throw new Error("no keysets");

      let recovered = 0;
      const keysetCounters: Record<string, number | undefined> = {};
      for (const ks of keysets) {
        onProgress?.(`scanning ${mintUrl} (${ks.id})…`);
        const { proofs, lastCounterWithSignature } = await wallet.batchRestore(
          300,
          100,
          0,
          ks.id,
        );
        if (lastCounterWithSignature !== undefined) {
          keysetCounters[ks.id] = lastCounterWithSignature;
        }
        if (proofs.length === 0) continue;
        const { unspent } = await wallet.groupProofsByState(proofs);
        if (unspent.length > 0) {
          storeProofsInWallet(filterNewProofs(mintUrl, unspent), mintUrl);
          recovered += unspent.reduce((a, p) => a + Number(p.amount), 0);
        }
      }
      // The restore consumed counters up to lastCounterWithSignature; advance
      // the account's persistent source past them so future mints don't
      // re-derive the same secrets as pre-loss outputs.
      await advanceCountersPastRecovery(
        deriveAccountFromWords(mnemonic).pubkey,
        keysetCounters,
      );
      results.push({ mint: mintUrl, recovered });
    } catch (err) {
      onProgress?.(`${mintUrl}: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ mint: mintUrl, recovered: 0 });
    }
  }
  return results;
}

/**
 * Background auto-recovery: with the app fixed to a single mint (config.ts),
 * restoring the phrase can scan that one mint for deterministically-created
 * proofs — no mint URL entry needed. Skips when the wallet store already
 * holds proofs for the default mint (idempotent re-login on the same device).
 * Fire-and-forget; failures are swallowed (the manual Recover button remains).
 */
export function autoRecoverBalance(mnemonic: string): void {
  const attempt = () => {
    void recoverBalanceFromSeed({ mnemonic, mintUrls: [DEFAULT_MINT] }).catch(() => {});
  };
  try {
    const store = JSON.parse(localStorage.getItem("cashu-wallet-v1") ?? "{}") as Record<
      string,
      unknown
    >;
    const existing = store[DEFAULT_MINT];
    if (Array.isArray(existing) && existing.length > 0) return; // already populated
    attempt();
  } catch {
    attempt(); // corrupt store — still try recovery
  }
}
