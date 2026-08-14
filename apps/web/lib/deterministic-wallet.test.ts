import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createNewMintKeys,
  deriveKeysetId,
  serializeMintKeys,
  serializeProofs,
  type Proof,
} from "@cashu/cashu-ts";
import {
  advanceCountersPastRecovery,
  createCounterSource,
  filterNewProofs,
  walletOptions,
  recoverBalanceFromSeed,
} from "./deterministic-wallet";
import { deriveAccountFromWords, saveAccount } from "./key-store";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

function proof(secret: string, amount: number): Proof {
  // cashu-ts types Proof.amount as Amount; numbers are the runtime shape
  return { id: "ks1", amount: amount as unknown as Proof["amount"], secret, C: "c" };
}

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

describe("recovery helpers", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("advanceCountersPastRecovery moves the counter past the restored range", async () => {
    const pubkey = "test-pubkey";
    await advanceCountersPastRecovery(pubkey, { ks1: 42, ks2: undefined });
    const src = createCounterSource(pubkey);
    const r1 = await src.reserve("ks1", 1);
    expect(r1.start).toBe(43);
    const r2 = await src.reserve("ks2", 1);
    expect(r2.start).toBe(0); // undefined → untouched
  });

  it("filterNewProofs drops proofs already in the store", () => {
    const existing = serializeProofs([proof("s1", 2)]);
    localStorage.setItem(
      "cashu-wallet-v1",
      JSON.stringify({ "https://mint.example": existing }),
    );
    const out = filterNewProofs("https://mint.example", [
      proof("s1", 2),
      proof("s2", 3),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.secret).toBe("s2");
  });
});

describe("recoverBalanceFromSeed", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function jsonResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  }

  /**
   * cashu-ts 4.5.1 fetch mock for a working mint. Built from the real request
   * shapes (observed from the mock's calls + cashu-ts source):
   *   - loadMint: GET /v1/info, /v1/keysets, /v1/keys (NUT-02 id must verify)
   *   - restore:  POST /v1/restore { outputs: [{id, amount:0, B_}] }; the
   *     response echoes the request outputs so cashu-ts can pair B_ -> signature
   *   - states:   POST /v1/checkstate { Ys: [sha256(secret)] } -> { states }
   * batchRestore stops only after gapLimit/batchSize=3 consecutive empty
   * batches, so the LAST restore call that can still return proofs is the
   * 3rd (counter=200): the two calls before and the three after are empty,
   * which makes cashu-ts report a definite lastCounterWithSignature from a
   * non-zero batch (200 + indexInBatch).
   */
  function installMintFetchMock(opts: { failHosts?: string[] } = {}) {
    const fail = new Set(opts.failHosts ?? []);
    // pubKeys are Uint8Arrays; the /v1/keys API serves hex strings, and
    // deriveKeysetId/verifyKeysetId operate on the serialized (hex) form.
    const { pubKeys } = createNewMintKeys(8);
    const keys = serializeMintKeys(pubKeys);
    // deriveKeysetId(keys) — NOT createNewMintKeys().keysetId: the mock's id
    // must equal what cashu-ts's verifyKeysetId recomputes from the raw hex
    // keys or the keychain drops the keys and forces a /v1/keys/{id} refetch.
    const keysetId = deriveKeysetId(keys);
    const keyset = { id: keysetId, unit: "sat", active: true, input_fee_ppk: 0 };
    const GENERATOR =
      "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798";
    const calls: { url: string; body: string }[] = [];
    let restoreCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
        if (fail.has(new URL(url).host)) {
          return jsonResponse({ error: "mint down" }, 500);
        }
        calls.push({ url, body: init?.body ?? "" });
        if (url.endsWith("/v1/info")) return jsonResponse({ name: "mock mint", nuts: {} });
        if (url.endsWith("/v1/keysets")) return jsonResponse({ keysets: [keyset] });
        if (url.endsWith("/v1/keys")) return jsonResponse({ keysets: [{ ...keyset, keys }] });
        if (url.endsWith("/v1/restore")) {
          restoreCalls += 1;
          const { outputs } = JSON.parse(init?.body ?? "{}") as { outputs: unknown[] };
          if (restoreCalls !== 3) return jsonResponse({ outputs: [], signatures: [] });
          return jsonResponse({
            outputs: outputs.slice(0, 2),
            signatures: [
              { id: keysetId, amount: 4, C_: GENERATOR },
              { id: keysetId, amount: 2, C_: GENERATOR },
            ],
          });
        }
        if (url.endsWith("/v1/checkstate")) {
          const { Ys } = JSON.parse(init?.body ?? "{}") as { Ys: string[] };
          return jsonResponse({
            states: Ys.map((Y, i) => ({ Y, state: i === 0 ? "UNSPENT" : "SPENT" })),
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );
    return { calls, keysetId };
  }

  it("restores unspent proofs and skips spent ones, reporting per-mint amounts", async () => {
    const { calls, keysetId } = installMintFetchMock();
    const results = await recoverBalanceFromSeed({
      mnemonic: MNEMONIC,
      mintUrls: ["https://mint.example"],
    });

    expect(results).toEqual([{ mint: "https://mint.example", recovered: 4 }]); // spent 2 dropped

    // restore payload: { outputs: [{id, amount, B_}] } — echoes the wallet's
    // blinded messages (the brief's guessed shapes differ; see report)
    const restoreCall = calls.find((c) => c.url.endsWith("/v1/restore"));
    expect(restoreCall).toBeDefined();
    const restoreBody = JSON.parse(restoreCall!.body) as {
      outputs: { id: string; amount: number; B_: string }[];
    };
    expect(restoreBody.outputs).toHaveLength(100);
    expect(restoreBody.outputs[0]!.id).toBeTruthy();
    expect(restoreBody.outputs[0]!.amount).toBe(0);
    expect(restoreBody.outputs[0]!.B_).toBeTruthy();

    // checkstate payload: { Ys: [sha256(secret) hex] } for each restored proof
    const checkstateCall = calls.find((c) => c.url.endsWith("/v1/checkstate"));
    expect(checkstateCall).toBeDefined();
    const checkstateBody = JSON.parse(checkstateCall!.body) as { Ys: string[] };
    expect(checkstateBody.Ys).toHaveLength(2);

    // only the unspent proof (amount 4) is merged into the wallet store
    const store = JSON.parse(localStorage.getItem("cashu-wallet-v1")!) as Record<
      string,
      string[]
    >;
    expect(store["https://mint.example"]).toBeDefined();
    expect(store["https://mint.example"]!).toHaveLength(1);
    expect(Number(JSON.parse(store["https://mint.example"]![0]!).amount)).toBe(4);

    // counter-advance invariant: the account's persistent source must sit past
    // the restored range so the next mint cannot re-derive pre-loss secrets.
    // The mock returns signatures only on the LAST signed batch (counter=200,
    // two echoed outputs => lastCounterWithSignature = 200 + 1 = 201), so the
    // cursor must land on 201 + 1 = 202.
    const advancedKey = `egavel-wallet-counters:${deriveAccountFromWords(MNEMONIC).pubkey}`;
    expect(JSON.parse(localStorage.getItem(advancedKey) ?? "{}")).toEqual({
      [keysetId]: 202,
    });
  });

  it("survives a failing mint and continues with the next", async () => {
    const { calls } = installMintFetchMock({ failHosts: ["mint-down.example"] });
    const results = await recoverBalanceFromSeed({
      mnemonic: MNEMONIC,
      mintUrls: ["https://mint-down.example", "https://mint-ok.example"],
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.recovered).toBe(0); // per-mint failure contained
    expect(results[1]!.recovered).toBe(4); // loop continued to the next mint
    expect(calls.some((c) => c.url.startsWith("https://mint-ok.example"))).toBe(true);
  });
});
