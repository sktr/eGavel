import { describe, it, expect, beforeEach } from "vitest";
import {
  storeProofsInWallet,
  replaceMintProofs,
  mergeMintBalances,
  walletPrivkeyHex,
  WALLET_CHANGED_EVENT,
  loadStore,
  pickWithdrawMint,
  sumStoredAmounts,
  unspentWithoutP2PK,
  isP2PKSecret,
} from "./wallet";
import { deserializeProofs } from "@cashu/cashu-ts";
import type { Proof } from "@cashu/cashu-ts";
import { deriveAccountFromWords, saveAccount } from "./key-store";
import { stubWindow, restoreWindow } from "./test-utils";

describe("wallet change notification", () => {
  beforeEach(() => {
    localStorage.clear();
    restoreWindow();
  });

  it("storeProofsInWallet dispatches WALLET_CHANGED_EVENT so the header balance refreshes", () => {
    const listeners = stubWindow();
    let fired = 0;
    (globalThis as unknown as { window: { addEventListener: (t: string, f: () => void) => void } }).window.addEventListener(
      WALLET_CHANGED_EVENT,
      () => {
        fired += 1;
      },
    );
    void listeners; // stubWindow returns the map for future assertions

    storeProofsInWallet([] as Proof[], "https://mint.example", "any-account");

    expect(fired).toBe(1);
  });

  it("does not throw when window is unavailable (SSR / node)", () => {
    expect(() => storeProofsInWallet([] as Proof[], "https://mint.example", "any-account")).not.toThrow();
  });
});

describe("per-account wallet store namespacing", () => {
  beforeEach(() => {
    localStorage.clear();
    restoreWindow();
  });

  it("stores proofs under the account pubkey so accounts never share proofs", () => {
    const listeners = stubWindow();
    void listeners;
    const proofA = { id: "k1", amount: 10, secret: "sA", C: "cA" } as unknown as Proof;
    const proofB = { id: "k1", amount: 20, secret: "sB", C: "cB" } as unknown as Proof;

    storeProofsInWallet([proofA], "https://mint.example", "pubkey-a");
    storeProofsInWallet([proofB], "https://mint.example", "pubkey-b");

    const storeA = JSON.parse(localStorage.getItem("cashu-wallet-v1:pubkey-a") ?? "{}") as Record<string, string[]>;
    const storeB = JSON.parse(localStorage.getItem("cashu-wallet-v1:pubkey-b") ?? "{}") as Record<string, string[]>;
    // Account A's store contains only A's proof; account B's only B's.
    expect(storeA["https://mint.example"]).toHaveLength(1);
    expect(storeA["https://mint.example"]![0]).toContain("sA");
    expect(storeB["https://mint.example"]![0]).toContain("sB");
    expect(storeA["https://mint.example"]![0]).not.toContain("sB");
    // The un-namespaced legacy key must not be written anymore.
    expect(localStorage.getItem("cashu-wallet-v1")).toBeNull();
  });

  it("dedupes proofs already present in the store (auto-collect may re-fetch the same change)", () => {
    const listeners = stubWindow();
    void listeners;
    const proof = { id: "k1", amount: 10, secret: "sA", C: "cA" } as unknown as Proof;

    storeProofsInWallet([proof], "https://mint.example", "pubkey-a");
    storeProofsInWallet([proof], "https://mint.example", "pubkey-a");
    storeProofsInWallet([proof], "https://mint.example", "pubkey-a");

    const storeA = JSON.parse(localStorage.getItem("cashu-wallet-v1:pubkey-a") ?? "{}") as Record<string, string[]>;
    expect(storeA["https://mint.example"]).toHaveLength(1);
  });

  it("migrates the legacy shared store into the first account that touches it", () => {
    const listeners = stubWindow();
    void listeners;
    // Legacy stores hold serialized proof JSON strings (one per proof).
    const legacyProof = JSON.stringify({ id: "k1", amount: 7, secret: "legacy", C: "cL" });
    const legacyProofs = JSON.stringify({ "https://mint.example": [legacyProof] });
    localStorage.setItem("cashu-wallet-v1", legacyProofs);

    storeProofsInWallet([] as Proof[], "https://mint.example", "first-account");

    // The legacy data was claimed under the first account's key.
    const claimed = JSON.parse(localStorage.getItem("cashu-wallet-v1:first-account") ?? "{}") as Record<string, string[]>;
    expect(claimed["https://mint.example"]).toContain(legacyProof);
    // A second account starts empty — no cross-account leakage.
    expect(localStorage.getItem("cashu-wallet-v1:second-account")).toBeNull();
  });
});

describe("loadStore reads the account-namespaced store (withdraw bug regression)", () => {
  beforeEach(() => {
    localStorage.clear();
    restoreWindow();
  });

  it("loadStore returns proofs stored under the account's namespaced key", () => {
    const listeners = stubWindow();
    void listeners;
    const proof = { id: "k1", amount: 10, secret: "sA", C: "cA" } as unknown as Proof;

    storeProofsInWallet([proof], "https://mint.example", "pubkey-a");

    const store = loadStore("pubkey-a");
    const stored = deserializeProofs(store["https://mint.example"] ?? []);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.secret).toBe("sA");
  });

  it("loadStore does not fall back to the legacy shared key once namespaced data exists", () => {
    const listeners = stubWindow();
    void listeners;
    const proofA = { id: "k1", amount: 10, secret: "sA", C: "cA" } as unknown as Proof;
    // A stale legacy store from another account must not leak into this one.
    const legacyProof = JSON.stringify({ id: "k2", amount: 99, secret: "other", C: "cX" });
    localStorage.setItem("cashu-wallet-v1", JSON.stringify({ "https://mint.example": [legacyProof] }));
    localStorage.setItem("cashu-wallet-v1:migrated", "1");

    storeProofsInWallet([proofA], "https://mint.example", "pubkey-a");

    const store = loadStore("pubkey-a");
    const stored = deserializeProofs(store["https://mint.example"] ?? []);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.secret).toBe("sA");
    expect(stored[0]!.secret).not.toBe("other");
  });
});

describe("sumStoredAmounts (optimistic balance display)", () => {
  beforeEach(() => {
    localStorage.clear();
    restoreWindow();
  });

  it("sums the amounts of stored proof JSON strings", () => {
    const raw = [
      JSON.stringify({ amount: 10 }),
      JSON.stringify({ amount: 25 }),
      JSON.stringify({ amount: 5 }),
    ];
    expect(sumStoredAmounts(raw)).toBe(40);
  });

  it("returns 0 for an empty list", () => {
    expect(sumStoredAmounts([])).toBe(0);
  });

  it("skips unparseable entries instead of throwing", () => {
    const raw = [JSON.stringify({ amount: 7 }), "not-json", JSON.stringify({ amount: 3 })];
    expect(sumStoredAmounts(raw)).toBe(10);
  });

  it("reads the optimistic balance straight from the store without the mint", () => {
    const proofA = { id: "k1", amount: 30, secret: "sA", C: "cA" } as unknown as Proof;
    storeProofsInWallet([proofA], "https://mint.example", "pubkey-a");
    const store = loadStore("pubkey-a");
    expect(sumStoredAmounts(store["https://mint.example"] ?? [])).toBe(30);
  });

  it("excludes P2PK-locked proofs from the optimistic balance", () => {
    // A 1-of-1 P2PK change proof (winner lock) is NOT spendable as a normal
    // proof — it must not inflate the displayed balance.
    const p2pkProof = JSON.stringify({
      id: "k1",
      amount: 50,
      secret: '["P2PK","seller",[["pubkeys","winnerpub"],["n_sigs","1"],["sigflag","SIG_INPUTS"]]]',
      C: "cP",
    });
    const normalProof = JSON.stringify({ id: "k2", amount: 10, secret: "sN", C: "cN" });
    const raw = [p2pkProof, normalProof];
    expect(sumStoredAmounts(raw)).toBe(10);
  });

  it("unspentWithoutP2PK drops P2PK-locked proofs from a spend list", () => {
    const p2pk = {
      id: "k1",
      amount: 50,
      secret: '["P2PK","seller",[["pubkeys","winnerpub"],["n_sigs","1"],["sigflag","SIG_INPUTS"]]]',
      C: "cP",
    } as unknown as Proof;
    const normal = { id: "k2", amount: 10, secret: "sN", C: "cN" } as unknown as Proof;
    const filtered = unspentWithoutP2PK([p2pk, normal]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.secret).toBe("sN");
  });

  it("isP2PKSecret distinguishes P2PK secrets from ordinary ones", () => {
    expect(
      isP2PKSecret(
        '["P2PK","seller",[["pubkeys","winnerpub"],["n_sigs","1"],["sigflag","SIG_INPUTS"]]]',
      ),
    ).toBe(true);
    expect(isP2PKSecret("plain-secret")).toBe(false);
    expect(isP2PKSecret("not-json")).toBe(false);
  });
});

describe("pickWithdrawMint", () => {
  const byMint = [
    { mint: "https://mint-a.example", amount: 0 },
    { mint: "https://mint-b.example", amount: 500 },
    { mint: "https://mint-c.example", amount: 300 },
  ];

  it("prefers the user-selected mint when it has balance", () => {
    expect(pickWithdrawMint(byMint, "https://mint-c.example", "https://default.example")).toBe(
      "https://mint-c.example",
    );
  });

  it("falls back to the first mint with balance when the selection has none", () => {
    // Selected mint has zero balance → pick the first mint that holds sats.
    const selection = "https://mint-a.example";
    expect(pickWithdrawMint(byMint, selection, "https://default.example")).toBe(
      "https://mint-b.example",
    );
  });

  it("falls back to the default mint when no mint holds balance", () => {
    const empty = [
      { mint: "https://mint-a.example", amount: 0 },
      { mint: "https://mint-b.example", amount: 0 },
    ];
    expect(pickWithdrawMint(empty, "https://mint-a.example", "https://default.example")).toBe(
      "https://default.example",
    );
  });

  it("falls back to the default mint when the balance list is empty", () => {
    expect(pickWithdrawMint([], null, "https://default.example")).toBe("https://default.example");
  });
});

describe("replaceMintProofs (withdraw store hygiene)", () => {
  beforeEach(() => {
    localStorage.clear();
    restoreWindow();
  });

  it("replaces the mint's proofs instead of merging (spent proofs are dropped)", () => {
    const listeners = stubWindow();
    void listeners;
    // A withdraw spent proofA at the mint; proofB is the change. The old code
    // merged via storeProofsInWallet, leaving the spent proof in the store so
    // the optimistic balance over-counted when the mint was unreachable.
    const spentA = { id: "k1", amount: 500, secret: "spentA", C: "cA" } as unknown as Proof;
    const changeB = { id: "k1", amount: 300, secret: "changeB", C: "cB" } as unknown as Proof;
    storeProofsInWallet([spentA, changeB], "https://mint.example", "pubkey-a");

    replaceMintProofs([changeB], "https://mint.example", "pubkey-a");

    const store = loadStore("pubkey-a");
    const stored = deserializeProofs(store["https://mint.example"] ?? []);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.secret).toBe("changeB");
    // The spent proof must not resurface in the optimistic sum.
    expect(sumStoredAmounts(store["https://mint.example"] ?? [])).toBe(300);
  });

  it("namespaces per pubkey like storeProofsInWallet", () => {
    const listeners = stubWindow();
    void listeners;
    const proof = { id: "k1", amount: 10, secret: "sA", C: "cA" } as unknown as Proof;
    storeProofsInWallet([proof], "https://mint.example", "pubkey-a");
    storeProofsInWallet([proof], "https://mint.example", "pubkey-b");

    replaceMintProofs([], "https://mint.example", "pubkey-a");

    // Account A's mint entry is cleared; account B keeps its proofs.
    const storeA = loadStore("pubkey-a");
    expect(storeA["https://mint.example"] ?? []).toHaveLength(0);
    const storeB = loadStore("pubkey-b");
    expect(deserializeProofs(storeB["https://mint.example"] ?? [])).toHaveLength(1);
  });

  it("dispatches WALLET_CHANGED_EVENT so the header balance refreshes", () => {
    const listeners = stubWindow();
    let fired = 0;
    (globalThis as unknown as { window: { addEventListener: (t: string, f: () => void) => void } }).window.addEventListener(
      WALLET_CHANGED_EVENT,
      () => {
        fired += 1;
      },
    );
    void listeners;

    replaceMintProofs([] as Proof[], "https://mint.example", "pubkey-a");

    expect(fired).toBe(1);
  });
});

describe("mergeMintBalances (verified vs optimistic with staleness)", () => {
  const local = [
    { mint: "https://mint-a.example", amount: 500 },
    { mint: "https://mint-b.example", amount: 300 },
  ];

  it("uses verified amounts when every mint responds", () => {
    const r = mergeMintBalances(local, [
      { mint: "https://mint-a.example", amount: 450, ok: true },
      { mint: "https://mint-b.example", amount: 250, ok: true },
    ]);
    expect(r.stale).toBe(false);
    expect(r.total).toBe(700);
    expect(r.byMint).toEqual([
      { mint: "https://mint-a.example", amount: 450 },
      { mint: "https://mint-b.example", amount: 250 },
    ]);
  });

  it("keeps the optimistic estimate and marks stale when a mint is unreachable", () => {
    const r = mergeMintBalances(local, [
      { mint: "https://mint-a.example", amount: 450, ok: true },
      { mint: "https://mint-b.example", amount: 0, ok: false },
    ]);
    expect(r.stale).toBe(true);
    expect(r.total).toBe(750); // 450 verified + 300 optimistic (mint-b unreachable)
    expect(r.byMint).toEqual([
      { mint: "https://mint-a.example", amount: 450 },
      { mint: "https://mint-b.example", amount: 300 },
    ]);
  });

  it("drops zero-verified mints entirely", () => {
    const r = mergeMintBalances(local, [
      { mint: "https://mint-a.example", amount: 0, ok: true },
      { mint: "https://mint-b.example", amount: 250, ok: true },
    ]);
    expect(r.stale).toBe(false);
    expect(r.total).toBe(250);
    expect(r.byMint).toEqual([{ mint: "https://mint-b.example", amount: 250 }]);
  });

  it("returns an empty result for an empty input", () => {
    const r = mergeMintBalances([], []);
    expect(r.stale).toBe(false);
    expect(r.total).toBe(0);
    expect(r.byMint).toEqual([]);
  });
});

describe("walletPrivkeyHex (P2PK witness signing)", () => {
  const MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

  beforeEach(() => {
    localStorage.clear();
    restoreWindow();
  });

  it("returns the stored account's secret key hex for its own pubkey", () => {
    const account = deriveAccountFromWords(MNEMONIC);
    saveAccount(account);
    expect(walletPrivkeyHex(account.pubkey)).toBe(account.secretKeyHex);
  });

  it("returns null when the pubkey does not match the stored account", () => {
    const account = deriveAccountFromWords(MNEMONIC);
    saveAccount(account);
    expect(walletPrivkeyHex("03deadbeef")).toBeNull();
  });

  it("returns null when no account is stored", () => {
    expect(walletPrivkeyHex("03cafebabe")).toBeNull();
  });
});
