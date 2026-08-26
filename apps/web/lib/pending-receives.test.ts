import { describe, it, expect, vi, beforeEach } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex";
import { collectPendingReceipts } from "./wallet";

function kp() {
  const sk = bytesToHex(schnorr.utils.randomSecretKey());
  return { sk, pk: bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) };
}
const digestOf = (s: string) => sha256(new TextEncoder().encode(s));
const verifies = (sig: string, msg: string, pk: string) =>
  schnorr.verify(hexToBytes(sig), digestOf(msg), hexToBytes(pk));

const RECEIPT = {
  rid: 7,
  mint_url: "https://mint.example",
  proofs: JSON.stringify([{ id: "01fc0ec0e59cd6fa01b7a88f8cd77fce81fd1e64bca67d752e984992b7a3c3a821", amount: 5, secret: "a1", C: "02" + "c".repeat(62) }]),
  amount: 5,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) };
}

let fetchMock: ReturnType<typeof vi.fn>;
let store: { receive: (t: string) => Promise<unknown> };
let stored: string[];
let alice: ReturnType<typeof kp>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  alice = kp();
  stored = [];
  store = { receive: async (t: string) => { stored.push(t); } };
});

const run = () =>
  collectPendingReceipts({ pubkey: alice.pk, skHex: alice.sk, store });

describe("collectPendingReceipts", () => {
  it("GETs receipts read-only, stores them, and acks the stored rids", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, receipts: [RECEIPT] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, deleted: 1 }));

    const result = await run();

    expect(result).toEqual({ collectedAmount: 5, collectedCount: 1, failedCount: 0 });
    expect(stored).toHaveLength(1);
    // Second call is the signed ack with exactly the stored rid.
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/wallet/receive/ack");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.receiver_pubkey).toBe(alice.pk);
    expect(verifies(body.sig as string, `wallet-receive-ack:${alice.pk}`, alice.pk)).toBe(true);
    expect(body.rowids).toEqual([7]);
  });

  it("leaves a failed receipt on the server (no ack) and reports it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, receipts: [{ ...RECEIPT, rid: 9 }] }));
    store.receive = async () => { throw new Error("network hiccup"); };

    const result = await run();

    expect(result).toEqual({ collectedAmount: 0, collectedCount: 0, failedCount: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no ack request
  });

  it("acks already-stored duplicates instead of retrying forever", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, receipts: [{ ...RECEIPT, rid: 11 }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, deleted: 1 }));
    store.receive = async () => { throw new Error("Token already stored"); };

    const result = await run();
    expect(result.collectedCount, JSON.stringify(result)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns zeros without any ack when there are no receipts", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, receipts: [] }));
    const result = await run();
    expect(result).toEqual({ collectedAmount: 0, collectedCount: 0, failedCount: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
