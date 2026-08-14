import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Proof } from "@cashu/cashu-ts";
import { swapLockedProofs } from "./claim";
import { storeProofsInWallet } from "./wallet";
import {
  computeBidId,
  buildPendingEntry,
  loadPendingBids,
  savePendingBid,
  updatePendingBidStatus,
  removePendingBid,
  reconcileEntry,
  placeBid,
  recoverAfterLocktime,
  myBidState,
  type PendingBidEntry,
} from "./pending-bids";

vi.mock("./claim", () => ({
  swapLockedProofs: vi.fn(),
}));
vi.mock("./wallet", () => ({
  storeProofsInWallet: vi.fn(),
}));

const RECOVERED_PROOFS = [
  { keyset_id: "ks2", C: "r1", secret: "recovered", amount: 500 },
] as unknown as Proof[];

const SECRET_A = JSON.stringify([
  "P2PK",
  {
    nonce: "n1",
    data: "02deadbeef",
    tags: [
      ["pubkeys", "04server", "03cafebabe"],
      ["n_sigs", "2"],
      ["locktime", String(Math.floor(Date.now() / 1000) + 86400)],
      ["refund", "03cafebabe"],
    ],
  },
]);

function entry(overrides: Partial<PendingBidEntry> = {}): PendingBidEntry {
  return {
    bidId: computeBidId("a1", [SECRET_A]),
    auctionId: "a1",
    bidderPubkey: "03cafebabe",
    mintUrl: "https://mint.example",
    amount: 500,
    locktime: Math.floor(Date.now() / 1000) + 86400,
    proofs: [{ keyset_id: "ks1", C: "c", secret: SECRET_A, amount: 500 }],
    payload: JSON.stringify({ auction_id: "a1", amount: 500, bidder_pubkey: "03cafebabe" }),
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("pending-bids store", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("builds a deterministic bid id from the proofs' Ys", () => {
    const id = computeBidId("a1", [SECRET_A]);
    expect(id.startsWith("a1-")).toBe(true);
    expect(id.length).toBeGreaterThan("a1-".length + 5);
    expect(computeBidId("a1", [SECRET_A])).toBe(id); // deterministic
  });

  it("save/load/update/remove round-trips entries", () => {
    const e = entry();
    savePendingBid(e);
    expect(loadPendingBids()).toHaveLength(1);
    updatePendingBidStatus(e.bidId, "live");
    expect(loadPendingBids()[0]!.status).toBe("live");
    // upsert replaces, does not duplicate
    savePendingBid(e);
    expect(loadPendingBids()).toHaveLength(1);
    removePendingBid(e.bidId);
    expect(loadPendingBids()).toHaveLength(0);
  });

  it("ignores corrupt stored JSON", () => {
    localStorage.setItem("egavel-pending-bids", "{not json");
    expect(loadPendingBids()).toEqual([]);
  });

  it("buildPendingEntry computes the deterministic bid id and starts pending", () => {
    const e = buildPendingEntry({
      auctionId: "a1",
      bidderPubkey: "03cafebabe",
      mintUrl: "https://mint.example",
      amount: 500,
      locktime: Math.floor(Date.now() / 1000) + 3600,
      proofs: [{ keyset_id: "ks1", C: "c", secret: SECRET_A, amount: 500 }],
      payload: "{}",
    });
    expect(e.bidId).toBe(computeBidId("a1", [SECRET_A]));
    expect(e.status).toBe("pending");
  });
});

describe("reconcileEntry", () => {
  const e = entry();
  const base = "http://api.test";

  afterEach(() => vi.restoreAllMocks());

  it("classifies 404 as unregistered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    expect(await reconcileEntry(e, base)).toBe("unregistered");
  });

  it("classifies 200 as refundable (pending or outbid)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ proofs: [] }) }));
    expect(await reconcileEntry(e, base)).toBe("refundable");
  });

  it("classifies NOT_OUTBID as live", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 400, json: async () => ({ error: "NOT_OUTBID" }) }));
    expect(await reconcileEntry(e, base)).toBe("live");
  });

  it("classifies ALREADY_REFUNDED as refunded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 400, json: async () => ({ error: "ALREADY_REFUNDED" }) }));
    expect(await reconcileEntry(e, base)).toBe("refunded");
  });
});

describe("placeBid", () => {
  const e = entry();
  const base = "http://api.test";
  afterEach(() => vi.restoreAllMocks());

  it("pre-registers then submits the live bid and marks the entry live", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ?? "" });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    savePendingBid(e); // bid-form persists BEFORE calling placeBid
    const result = await placeBid({ payload: JSON.parse(e.payload), entry: e, apiBase: base });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(`${base}/api/bids`);
    expect(JSON.parse(calls[0]!.body).mode).toBe("pending");
    expect(JSON.parse(calls[1]!.body).mode).toBeUndefined();
    expect(loadPendingBids()[0]!.status).toBe("live");
  });

  it("keeps the entry pending when the live bid is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "verify error: TOO_LATE" }) }));
    savePendingBid(e);
    const result = await placeBid({ payload: JSON.parse(e.payload), entry: e, apiBase: base });
    expect(result.ok).toBe(false);
    expect(loadPendingBids()[0]!.status).toBe("pending");
  });

  it("still submits the live bid when the pre-register rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    savePendingBid(e);
    const result = await placeBid({ payload: JSON.parse(e.payload), entry: e, apiBase: base });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).mode).toBe("pending");
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).mode).toBeUndefined();
    expect(loadPendingBids()[0]!.status).toBe("live");
  });
});

describe("recoverAfterLocktime", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(swapLockedProofs).mockResolvedValue(RECOVERED_PROOFS);
  });

  it("throws before locktime and does not call the swap", async () => {
    const e = entry({ locktime: Math.floor(Date.now() / 1000) + 3600 });
    await expect(recoverAfterLocktime(e, "abc123")).rejects.toThrow("locktime not reached");
    expect(swapLockedProofs).not.toHaveBeenCalled();
    expect(storeProofsInWallet).not.toHaveBeenCalled();
  });

  it("swaps the locked proofs and marks the entry refunded after locktime", async () => {
    const e = entry({ locktime: Math.floor(Date.now() / 1000) - 60 });
    savePendingBid(e);
    await recoverAfterLocktime(e, "abc123");
    expect(swapLockedProofs).toHaveBeenCalledTimes(1);
    const [proofsArg, amountArg, skArg] = vi.mocked(swapLockedProofs).mock.calls[0]!;
    expect(amountArg).toBe(500);
    expect(skArg).toBe("abc123");
    expect(proofsArg).toHaveLength(1);
    expect(proofsArg[0]).toEqual(
      expect.objectContaining({
        id: "ks1",
        amount: 500,
        secret: SECRET_A,
        C: "c",
        mint_url: "https://mint.example",
      }),
    );
    expect(storeProofsInWallet).toHaveBeenCalledWith(RECOVERED_PROOFS, "https://mint.example");
    expect(loadPendingBids()[0]!.status).toBe("refunded");
  });
});

describe("myBidState", () => {
  const leader = { id: "a1-aaa111", current_amount: 100, bidder_npub: "03cafebabe" };
  const otherLeader = { id: "a1-bbb222", current_amount: 300, bidder_npub: "05other" };
  const entries = [
    { ...entry(), bidId: leader.id, amount: 500, status: "live" as const },
  ];

  it("reports leader with standing price and max", () => {
    const s = myBidState("a1", [leader], entries, "03cafebabe");
    expect(s.kind).toBe("leader");
    if (s.kind === "leader") {
      expect(s.standingPrice).toBe(100);
      expect(s.max).toBe(500);
    }
  });

  it("reports confirming while a pending entry exists", () => {
    const e = { ...entry(), status: "pending" as const };
    const s = myBidState("a1", [], [e], "03cafebabe");
    expect(s.kind).toBe("confirming");
  });

  it("reports outbid when the leader is someone else", () => {
    const e = { ...entry(), status: "live" as const };
    const s = myBidState("a1", [otherLeader], [e], "03cafebabe");
    expect(s.kind).toBe("outbid");
  });

  it("reports none with no relevant entry", () => {
    expect(myBidState("a1", [otherLeader], [], "03cafebabe").kind).toBe("none");
  });

  it("prefers the newest entry when two bundles coexist for the same auction", () => {
    const older = { ...entry(), amount: 500, status: "live" as const, createdAt: 1000 };
    const newer = { ...entry(), amount: 700, status: "pending" as const, createdAt: 2000 };
    const s = myBidState("a1", [], [older, newer], "03cafebabe");
    expect(s.kind).toBe("confirming");
    expect(s.max).toBe(700);
  });
});
