import { describe, it, expect, beforeEach } from "vitest";
import { initDb, type Db } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import type { Auction, Bid } from "@egavel/shared";

const SELLER = "02deadbeef";
const SERVER = "04server";
const BIDDER = "03cafebabe";

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "a1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: SELLER,
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  };
}

function makeBid(overrides: Partial<Bid> = {}): Bid {
  return {
    id: "b1",
    auction_id: "a1",
    max_amount: 500,
    current_amount: 210,
    bidder_npub: BIDDER,
    Y: "y",
    received_at: Date.now(),
    status: "verified",
    proof_data: null,
    ...overrides,
  };
}

describe("auctions list standing price", () => {
  let db: Db;

  beforeEach(() => {
    db = initDb();
  });

  it("GET /api/auctions includes current_amount from the leading verified bid", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(makeAuction());
    await db.saveBid(makeBid({ current_amount: 210 }));
    await db.saveBid(
      makeBid({
        id: "b2",
        bidder_npub: "05other",
        max_amount: 300,
        current_amount: 160,
      }),
    );

    const res = await app.request("http://localhost/api/auctions");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Auction[];
    expect(list[0]!.current_amount).toBe(210);
  });

  it("GET /api/auctions falls back to start_price when there are no verified bids", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(makeAuction({ start_price: 100 }));

    const res = await app.request("http://localhost/api/auctions");
    const list = (await res.json()) as Auction[];
    expect(list[0]!.current_amount).toBe(100);
  });

  it("a settled auction with no winner shows the start price, not 0", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(
      makeAuction({ state: "SETTLED", winner_npub: null, winning_amount: 0 }),
    );

    const res = await app.request("http://localhost/api/auctions");
    const list = (await res.json()) as Auction[];
    expect(list[0]!.current_amount).toBe(100);
  });

  it("a settled auction with a winner shows the winning amount", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(
      makeAuction({ state: "SETTLED", winner_npub: BIDDER, winning_amount: 3600 }),
    );

    const res = await app.request("http://localhost/api/auctions");
    const list = (await res.json()) as Auction[];
    expect(list[0]!.current_amount).toBe(3600);
  });

  it("GET /api/auctions/:id includes current_amount (with and without with_bids)", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(makeAuction());
    await db.saveBid(makeBid({ current_amount: 210 }));

    const plain = await app.request("http://localhost/api/auctions/a1");
    const auction = (await plain.json()) as Auction;
    expect(auction.current_amount).toBe(210);

    const withBids = await app.request("http://localhost/api/auctions/a1?with_bids=1");
    const combined = (await withBids.json()) as { auction: Auction; bids: Bid[] };
    expect(combined.auction.current_amount).toBe(210);
  });

  it("never exposes max_amount on the list response", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(makeAuction());
    await db.saveBid(makeBid({ max_amount: 500, current_amount: 210 }));

    const res = await app.request("http://localhost/api/auctions");
    const list = (await res.json()) as Array<Record<string, unknown>>;
    expect(list[0]).not.toHaveProperty("max_amount");
  });
});
