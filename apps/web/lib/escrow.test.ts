import { describe, it, expect, vi, beforeEach } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex";
import { fetchEscrow, markShipped, confirmReceipt, releaseEscrow, refundEscrow } from "./escrow";

function kp() {
  const sk = bytesToHex(schnorr.utils.randomSecretKey());
  return { sk, pk: bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) };
}
const digestOf = (s: string) => sha256(new TextEncoder().encode(s));
const verifies = (sig: string, secret: string, pk: string) =>
  schnorr.verify(hexToBytes(sig), digestOf(secret), hexToBytes(pk));

const ESCROW_BODY = {
  auction_id: "a1",
  shipped: 1,
  created_at: Date.now(),
  proofs_data: JSON.stringify({
    proofs: [
      { keyset_id: "ks1", C: "c1", secret: "s1", amount: 60 },
      { keyset_id: "ks1", C: "c2", secret: "s2", amount: 40 },
    ],
    mint_url: "https://mint.example",
    amount: 100,
  }),
  timeout_expired: false,
};

/** fetch mock: GET (escrow view) then POST (action) */
function mockGetThenPost(postBody: Record<string, unknown>) {
  const postJson = Promise.resolve({ ok: true, amount: 100 });
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ESCROW_BODY) })
    .mockResolvedValueOnce({ ok: true, json: () => postJson });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("fetchEscrow", () => {
  it("fetches GET /escrow with signed query", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(ESCROW_BODY) });
    const party = kp();
    const res = await fetchEscrow("a1", party.pk, party.sk);
    expect(res.auction_id).toBe("a1");
    expect(res.shipped).toBe(1);
    expect(fetchMock.mock.calls[0]![0] as string).toContain("/auctions/a1/escrow?");
  });
});

describe("markShipped", () => {
  it("POSTs seller auth signature over shipped:<id>", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const seller = kp();
    await markShipped("a1", seller.pk, seller.sk);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/auctions/a1/shipped");
    const body = JSON.parse(init.body as string);
    expect(body.seller_pubkey).toBe(seller.pk);
    expect(verifies(body.seller_sig, "shipped:a1", seller.pk)).toBe(true);
  });
});

describe("confirmReceipt", () => {
  it("signs every escrow proof secret and POSTs them with the auth signature", async () => {
    fetchMock.mockImplementation(mockGetThenPost({}));
    const winner = kp();
    await confirmReceipt("a1", winner.pk, winner.sk);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/auctions/a1/confirm");
    const body = JSON.parse(init.body as string) as Record<string, string | string[]>;
    expect(body.winner_pubkey).toBe(winner.pk);
    // auth signature over confirm:<id>
    expect(verifies(body.winner_sig as string, "confirm:a1", winner.pk)).toBe(true);
    // per-secret witness signatures for EVERY proof in proofs_data
    expect(body.secrets).toEqual(["s1", "s2"]);
    const sigs = body.winner_sigs as string[];
    expect(verifies(sigs[0]!, "s1", winner.pk)).toBe(true);
    expect(verifies(sigs[1]!, "s2", winner.pk)).toBe(true);
  });
});

describe("releaseEscrow", () => {
  it("signs every escrow proof secret and POSTs them with release:<id> auth", async () => {
    fetchMock.mockImplementation(mockGetThenPost({}));
    const seller = kp();
    await releaseEscrow("a1", seller.pk, seller.sk);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/auctions/a1/release");
    const body = JSON.parse(init.body as string) as Record<string, string | string[]>;
    expect(body.seller_pubkey).toBe(seller.pk);
    expect(verifies(body.seller_sig as string, "release:a1", seller.pk)).toBe(true);
    expect(body.secrets).toEqual(["s1", "s2"]);
    const sigs = body.seller_sigs as string[];
    expect(verifies(sigs[0]!, "s1", seller.pk)).toBe(true);
    expect(verifies(sigs[1]!, "s2", seller.pk)).toBe(true);
  });
});

describe("refundEscrow", () => {
  it("signs every escrow proof secret and POSTs them with refund:<id> auth", async () => {
    fetchMock.mockImplementation(mockGetThenPost({}));
    const winner = kp();
    await refundEscrow("a1", winner.pk, winner.sk);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/auctions/a1/refund");
    const body = JSON.parse(init.body as string) as Record<string, string | string[]>;
    expect(body.winner_pubkey).toBe(winner.pk);
    expect(verifies(body.winner_sig as string, "refund:a1", winner.pk)).toBe(true);
    expect(body.secrets).toEqual(["s1", "s2"]);
    const sigs = body.winner_sigs as string[];
    expect(verifies(sigs[0]!, "s1", winner.pk)).toBe(true);
    expect(verifies(sigs[1]!, "s2", winner.pk)).toBe(true);
  });
});
