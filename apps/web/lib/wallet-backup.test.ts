import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeProofs, deserializeProofs, sumProofs, type Proof } from "@cashu/cashu-ts";
import { exportWalletBackup, importWalletBackup } from "./wallet-backup";

const STORAGE_KEY = "cashu-wallet-v1";

function proof(secret: string, amount: number): Proof {
  // cashu-ts types Proof.amount as Amount; numbers are the runtime shape
  return { id: "ks1", amount: amount as unknown as Proof["amount"], secret, C: "c" };
}

function seedStore(entries: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

describe("wallet-backup", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("exports the store as a version-1 blob", () => {
    seedStore({
      "https://mint.example": serializeProofs([proof("s1", 2), proof("s2", 3)]),
    });
    const blob = exportWalletBackup();
    const parsed = JSON.parse(blob) as { version: number; wallets: Record<string, string> };
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.wallets)).toEqual(["https://mint.example"]);
    expect(deserializeProofs(parsed.wallets["https://mint.example"]!)).toHaveLength(2);
  });

  it("round-trips: import(export()) restores the balance", () => {
    seedStore({
      "https://mint.example": serializeProofs([proof("s1", 2), proof("s2", 3)]),
    });
    const blob = exportWalletBackup();
    localStorage.clear();
    const results = importWalletBackup(blob);
    expect(results).toEqual([{ mint: "https://mint.example", amount: 5 }]);
    const restored = deserializeProofs(
      (JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, string>)[
        "https://mint.example"
      ]!,
    );
    expect(Number(sumProofs(restored))).toBe(5);
  });

  it("is idempotent: importing the same backup twice does not double the balance", () => {
    seedStore({
      "https://mint.example": serializeProofs([proof("s1", 2)]),
    });
    const blob = exportWalletBackup();
    importWalletBackup(blob);
    const results = importWalletBackup(blob);
    expect(results).toEqual([{ mint: "https://mint.example", amount: 2 }]);
    const restored = deserializeProofs(
      (JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, string>)[
        "https://mint.example"
      ]!,
    );
    expect(restored).toHaveLength(1); // deduped by secret
  });

  it("merges a second mint without losing the first", () => {
    seedStore({
      "https://mint.example": serializeProofs([proof("s1", 2)]),
    });
    const blob = exportWalletBackup();
    localStorage.clear();
    // import into a device that already holds another mint's balance
    seedStore({
      "https://other.example": serializeProofs([proof("t1", 7)]),
    });
    const results = importWalletBackup(blob);
    expect(results).toEqual([{ mint: "https://mint.example", amount: 2 }]);
    const store = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, string>;
    expect(deserializeProofs(store["https://other.example"]!)).toHaveLength(1);
    expect(deserializeProofs(store["https://mint.example"]!)).toHaveLength(1);
  });

  it("rejects garbage input", () => {
    expect(() => importWalletBackup("not json")).toThrow("invalid wallet backup");
    expect(() => importWalletBackup('{"hello":"world"}')).toThrow("invalid wallet backup");
  });

  it("rejects wrong version or non-string wallet values", () => {
    expect(() => importWalletBackup('{"version":2,"wallets":{}}')).toThrow("invalid wallet backup");
    expect(() =>
      importWalletBackup('{"version":1,"wallets":{"https://mint.example":42}}'),
    ).toThrow("invalid wallet backup");
  });
});
