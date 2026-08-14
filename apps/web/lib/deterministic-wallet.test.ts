import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCounterSource, walletOptions } from "./deterministic-wallet";
import { saveAccount } from "./key-store";

describe("createCounterSource", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("reserves counters and persists across reloads", async () => {
    const src = createCounterSource("pubkey-a");
    const r1 = await src.reserve("ks1", 3);
    expect(r1).toEqual({ start: 0, count: 3 });
    const r2 = await src.reserve("ks1", 2);
    expect(r2).toEqual({ start: 3, count: 2 });

    // new instance = "reload" — state must persist
    const src2 = createCounterSource("pubkey-a");
    const r3 = await src2.reserve("ks1", 1);
    expect(r3).toEqual({ start: 5, count: 1 });
  });

  it("namespaces counters per pubkey", async () => {
    const a = createCounterSource("pubkey-a");
    const b = createCounterSource("pubkey-b");
    await a.reserve("ks1", 5);
    const rb = await b.reserve("ks1", 1);
    expect(rb).toEqual({ start: 0, count: 1 });
  });

  it("peeks without mutating when n=0", async () => {
    const src = createCounterSource("pubkey-a");
    await src.reserve("ks1", 5);
    const peek = await src.reserve("ks1", 0);
    expect(peek).toEqual({ start: 5, count: 0 });
    const next = await src.reserve("ks1", 1);
    expect(next.start).toBe(5);
  });

  it("advanceToAtLeast bumps the cursor monotonically", async () => {
    const src = createCounterSource("pubkey-a");
    await src.advanceToAtLeast("ks1", 10);
    const r = await src.reserve("ks1", 1);
    expect(r.start).toBe(10);
    await src.advanceToAtLeast("ks1", 5); // no-op, behind
    const r2 = await src.reserve("ks1", 1);
    expect(r2.start).toBe(11);
  });
});

describe("walletOptions", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("includes bip39seed + counterSource when the account has a phrase", () => {
    saveAccount({
      secretKeyHex: "ab".repeat(32),
      pubkey: "cd".repeat(32),
      words: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    });
    const opts = walletOptions("https://mint.example") as {
      bip39seed?: Uint8Array;
      counterSource?: unknown;
    };
    expect(opts.bip39seed).toBeInstanceOf(Uint8Array);
    expect(opts.bip39seed!.length).toBe(64); // mnemonicToSeedSync output
    expect(opts.counterSource).toBeDefined();
  });

  it("returns plain options when the account has no phrase (legacy hex)", () => {
    saveAccount({ secretKeyHex: "ab".repeat(32), pubkey: "cd".repeat(32), words: null });
    const opts = walletOptions("https://mint.example") as { bip39seed?: unknown };
    expect(opts.bip39seed).toBeUndefined();
  });
});
