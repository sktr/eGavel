import { describe, it, expect, afterEach } from "vitest";
import { auctionFeeBps, calcFee } from "../src/lib/auction-fee.js";

const ORIGINAL = process.env.AUCTION_FEE_BPS;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.AUCTION_FEE_BPS;
  } else {
    process.env.AUCTION_FEE_BPS = ORIGINAL;
  }
});

describe("auctionFeeBps", () => {
  it("defaults to 0 (free marketplace) when the env var is unset", () => {
    delete process.env.AUCTION_FEE_BPS;
    expect(auctionFeeBps()).toBe(0);
  });

  it("honours an explicit AUCTION_FEE_BPS override", () => {
    process.env.AUCTION_FEE_BPS = "250";
    expect(auctionFeeBps()).toBe(250);
  });
});

describe("calcFee", () => {
  it("returns 0 on any winning amount when the fee is 0", () => {
    delete process.env.AUCTION_FEE_BPS;
    expect(calcFee(0)).toBe(0);
    expect(calcFee(1)).toBe(0);
    expect(calcFee(1_000_000)).toBe(0);
  });

  it("computes fee = floor(amount * bps / 10000) with an override", () => {
    process.env.AUCTION_FEE_BPS = "500";
    expect(calcFee(1000)).toBe(50);
    expect(calcFee(1)).toBe(0); // floor
  });
});
