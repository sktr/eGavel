import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  collectibleChangeAuctions,
  tryCollectChange,
  autoCollectChange,
  loadHandledChange,
  saveHandledChange,
} from "./auto-change";

const PUBKEY = "03cafebabe";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("collectibleChangeAuctions (which auctions need auto-collection)", () => {
  const auctions = {
    a1: { state: "SETTLED", winner_npub: PUBKEY },
    a2: { state: "SETTLED", winner_npub: "03other" },
    a3: { state: "ACTIVE", winner_npub: null },
  };

  it("picks my verified bid on a SETTLED auction where I won", () => {
    const bids = [
      { auction_id: "a1", status: "verified" },
      { auction_id: "a2", status: "verified" },
      { auction_id: "a3", status: "verified" },
      { auction_id: "a4", status: "outbid" },
    ] as { auction_id: string; status: string }[];
    const result = collectibleChangeAuctions(bids, auctions, PUBKEY);
    expect(result).toEqual(["a1"]);
  });

  it("skips bids that are not verified (outbid / refunded / pending)", () => {
    const bids = [
      { auction_id: "a1", status: "outbid" },
      { auction_id: "a1", status: "refunded" },
    ] as { auction_id: string; status: string }[];
    expect(collectibleChangeAuctions(bids, auctions, PUBKEY)).toEqual([]);
  });

  it("skips auctions not present in the lookup", () => {
    const bids = [{ auction_id: "missing", status: "verified" }] as {
      auction_id: string;
      status: string;
    }[];
    expect(collectibleChangeAuctions(bids, auctions, PUBKEY)).toEqual([]);
  });
});

describe("tryCollectChange (single auction outcome)", () => {
  const changeBody = {
    proofs: [{ keyset_id: "ks1", C: "c1", secret: "s1", amount: 200 }],
    amount: 200,
    mint_url: "https://mint.example",
  };

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("returns collected with the amount on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(changeBody)));
    const outcome = await tryCollectChange("a1", PUBKEY);
    expect(outcome).toEqual({ kind: "collected", auctionId: "a1", amount: 200 });
  });

  it("classifies NOT_CLAIMED as retryable (seller has not claimed yet)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "NOT_CLAIMED" }, 400)),
    );
    const outcome = await tryCollectChange("a1", PUBKEY);
    expect(outcome).toEqual({ kind: "not-claimed", auctionId: "a1" });
  });

  it("classifies NO_CHANGE as permanent (claimed, but max == winning price)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "NO_CHANGE" }, 400)),
    );
    const outcome = await tryCollectChange("a1", PUBKEY);
    expect(outcome).toEqual({ kind: "no-change", auctionId: "a1" });
  });

  it("classifies other failures as errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "boom" }, 500)),
    );
    const outcome = await tryCollectChange("a1", PUBKEY);
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") expect(outcome.auctionId).toBe("a1");
  });
});

describe("autoCollectChange (batch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("collects from every candidate auction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          proofs: [],
          amount: 100,
          mint_url: "https://mint.example",
        }),
      ),
    );
    const outcomes = await autoCollectChange(["a1", "a2"], PUBKEY);
    expect(outcomes.filter((o) => o.kind === "collected")).toHaveLength(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});

describe("handled-change persistence (per pubkey)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips the handled set through localStorage", () => {
    saveHandledChange(PUBKEY, new Set(["a1", "a2"]));
    const loaded = loadHandledChange(PUBKEY);
    expect(loaded.has("a1")).toBe(true);
    expect(loaded.has("a2")).toBe(true);
    expect(loaded.has("a3")).toBe(false);
  });

  it("namespaces the store per pubkey", () => {
    saveHandledChange(PUBKEY, new Set(["a1"]));
    expect(loadHandledChange("03other").size).toBe(0);
  });

  it("returns an empty set when nothing is stored", () => {
    expect(loadHandledChange(PUBKEY).size).toBe(0);
  });
});
