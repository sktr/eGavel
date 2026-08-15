import { describe, it, expect } from "vitest";
import { locktimeExpiredWinningEntries } from "./auto-recover";
import type { PendingBidEntry } from "./pending-bids";

const MY_PUBKEY = "03cafebabe";

function entry(overrides: Partial<PendingBidEntry> = {}): PendingBidEntry {
  return {
    bidId: "a1-abc123",
    auctionId: "a1",
    bidderPubkey: MY_PUBKEY,
    mintUrl: "https://mint.example",
    amount: 500,
    locktime: Math.floor(Date.now() / 1000) - 60,
    proofs: [{ keyset_id: "ks1", C: "c", secret: "s", amount: 500 }],
    payload: JSON.stringify({ auction_id: "a1", amount: 500 }),
    status: "live",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("locktimeExpiredWinningEntries", () => {
  const auctions = {
    a1: { state: "SETTLED", winner_npub: MY_PUBKEY, claimed: false },
    a2: { state: "SETTLED", winner_npub: "03other" },
  };

  it("selects live winning bids past locktime on settled unclaimed auctions", () => {
    const e = entry();
    const result = locktimeExpiredWinningEntries([e], auctions, MY_PUBKEY);
    expect(result).toContain(e);
  });

  it("excludes outbid/refunded entries", () => {
    const outbid = entry({ status: "outbid" });
    const refunded = entry({ bidId: "a1-def456", status: "refunded" });
    const result = locktimeExpiredWinningEntries([outbid, refunded], auctions, MY_PUBKEY);
    expect(result).toEqual([]);
  });

  it("excludes auctions I did not win", () => {
    const e = entry({ auctionId: "a2" });
    const result = locktimeExpiredWinningEntries([e], auctions, MY_PUBKEY);
    expect(result).toEqual([]);
  });

  it("excludes auctions not yet settled", () => {
    const active = { a1: { state: "ACTIVE", winner_npub: MY_PUBKEY } };
    const e = entry();
    const result = locktimeExpiredWinningEntries([e], active, MY_PUBKEY);
    expect(result).toEqual([]);
  });

  it("excludes entries whose locktime has not passed", () => {
    const e = entry({ locktime: Math.floor(Date.now() / 1000) + 3600 });
    const result = locktimeExpiredWinningEntries([e], auctions, MY_PUBKEY);
    expect(result).toEqual([]);
  });

  it("excludes auctions the seller already claimed", () => {
    const claimed = { a1: { state: "SETTLED", winner_npub: MY_PUBKEY, claimed: true } };
    const e = entry();
    const result = locktimeExpiredWinningEntries([e], claimed, MY_PUBKEY);
    expect(result).toEqual([]);
  });

  it("treats a missing auction in the lookup as ineligible", () => {
    const e = entry();
    const result = locktimeExpiredWinningEntries([e], {}, MY_PUBKEY);
    expect(result).toEqual([]);
  });

  it("honours an explicit now argument", () => {
    const future = entry({ locktime: Math.floor(Date.now() / 1000) + 3600 });
    const nowMs = (Math.floor(Date.now() / 1000) + 7200) * 1000;
    const result = locktimeExpiredWinningEntries([future], auctions, MY_PUBKEY, nowMs);
    expect(result).toContain(future);
  });
});
