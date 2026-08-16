import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  signSecretHex,
  buildWitness,
  swapLockedProofs,
  collectChange,
} from "./claim";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex";
import type { Proof } from "@cashu/cashu-ts";

// swapLockedProofs builds a wallet that talks to a live mint. For the
// collectChange P2PK path we stub buildWallet so the swap returns canned
// proofs; the real swap I/O is covered by the swapLockedProofs describe.
vi.mock("./deterministic-wallet", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, buildWallet: vi.fn() };
});

import { buildWallet } from "./deterministic-wallet";

describe("claim signing", () => {
  it("signSecretHex produces a Schnorr signature verifiable against the x-only pubkey", () => {
    const sk = schnorr.utils.randomSecretKey();
    const pk = bytesToHex(schnorr.getPublicKey(sk)); // x-only
    const secret = '["P2PK",{"nonce":"n","data":"02dead"}]';
    const sig = signSecretHex(secret, bytesToHex(sk));
    const digest = sha256(new TextEncoder().encode(secret));
    expect(schnorr.verify(hexToBytes(sig), digest, hexToBytes(pk))).toBe(true);
  });

  it("buildWitness merges seller and server signatures into a proof witness", () => {
    const proof = { id: "ks1", amount: 100, secret: "s", C: "c" };
    const result = buildWitness(proof, ["sig-a", "sig-b"]);
    expect(result.witness).toContain("sig-a");
    expect(result.witness).toContain("sig-b");
    expect(JSON.parse(result.witness as string).signatures).toEqual(["sig-a", "sig-b"]);
  });
});

describe("collectChange (proxy-bidding excess return)", () => {
  const changeBody = {
    proofs: [
      { keyset_id: "ks1", C: "c1", secret: "s1", amount: 200 },
      { keyset_id: "ks1", C: "c2", secret: "s2", amount: 50 },
    ],
    amount: 250,
    mint_url: "https://mint.example",
  };
  const bidderSk = bytesToHex(schnorr.utils.randomSecretKey());

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(changeBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("stores ordinary (non-P2PK) change proofs straight into the wallet", async () => {
    const result = await collectChange("a1", "03cafebabe", bidderSk);

    expect(result.amount).toBe(250);
    expect(result.mint_url).toBe("https://mint.example");

    const raw = localStorage.getItem("cashu-wallet-v1:03cafebabe")!;
    expect(raw).toBeTruthy();
    const store = JSON.parse(raw) as Record<string, string[]>;
    expect(store["https://mint.example"]).toHaveLength(2);
  });

  it("propagates NO_CHANGE from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "NO_CHANGE" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(collectChange("a1", "03cafebabe", bidderSk)).rejects.toThrow("NO_CHANGE");
  });

  it("swaps P2PK-locked change proofs before storing them", async () => {
    const p2pkBody = {
      proofs: [
        {
          keyset_id: "ks1",
          C: "c1",
          secret:
            '["P2PK","seller",[["pubkeys","winnerpub"],["n_sigs","1"],["sigflag","SIG_INPUTS"]]]',
          amount: 200,
        },
      ],
      amount: 200,
      mint_url: "https://mint.example",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(p2pkBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    // Stub the wallet that swapLockedProofs builds: loadMint no-ops,
    // prepareSwapToSend/prepareSwapToSend return canned outputs.
    (buildWallet as ReturnType<typeof vi.fn>).mockReturnValue({
      loadMint: async () => {},
      prepareSwapToSend: async () => ({ inputs: [], outputs: [] }),
      completeSwap: async () => ({
        send: [{ id: "ks1", amount: 200, secret: "swapped", C: "cs" }],
        keep: [],
      }),
    });
    const result = await collectChange("a1", "03cafebabe", bidderSk);

    expect(result.proofs).toHaveLength(1);
    expect((result.proofs[0] as unknown as { secret: string }).secret).toBe("swapped");
    const raw = localStorage.getItem("cashu-wallet-v1:03cafebabe")!;
    const store = JSON.parse(raw) as Record<string, string[]>;
    expect(store["https://mint.example"]![0]).toContain("swapped");
  });
});

describe("swapLockedProofs", () => {
  it("throws when the wallet cannot reach the mint", async () => {
    (buildWallet as ReturnType<typeof vi.fn>).mockReturnValue({
      loadMint: async () => {
        throw new Error("mint unreachable");
      },
    });
    const proof = {
      id: "ks1",
      amount: 100,
      secret: "s",
      C: "c",
      mint_url: "https://mint.example",
      witness: "",
    } as unknown as Proof;
    const sk = schnorr.utils.randomSecretKey();
    await expect(swapLockedProofs([proof], 100, bytesToHex(sk))).rejects.toThrow(
      "mint unreachable",
    );
  });
});
