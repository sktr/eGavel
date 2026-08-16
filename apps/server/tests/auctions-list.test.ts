import { describe, it, expect, beforeEach } from "vitest";
import { initDb, type Db } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import type { Auction, Bid } from "@egavel/shared";
import { schnorr } from "@noble/curves/secp256k1.js";
import { signSecret } from "../src/lib/schnorr.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";

const SELLER = "02deadbeef";
const SERVER = "04server";
const BIDDER = "03cafebabe";

/** Real keypair for seller-signed requests (the SELLER constant is a stub). */
function sellerKey() {
  const skHex = bytesToHex(schnorr.utils.randomSecretKey());
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(skHex)));
  return { skHex, pubkey };
}

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

  it("GET /api/auctions includes seller_nostr_pubkey when the seller has a link", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(makeAuction());
    await db.saveNostrLink(SELLER, "03linkednostr");

    const res = await app.request("http://localhost/api/auctions");
    const list = (await res.json()) as Auction[];
    expect(list[0]!.seller_nostr_pubkey).toBe("03linkednostr");
  });

  it("GET /api/auctions omits seller_nostr_pubkey when the seller has no link", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(makeAuction());

    const res = await app.request("http://localhost/api/auctions");
    const list = (await res.json()) as Auction[];
    expect(list[0]!.seller_nostr_pubkey).toBeUndefined();
  });

  it("GET /api/auctions/:id includes seller_nostr_pubkey when linked (with and without with_bids)", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(makeAuction());
    await db.saveNostrLink(SELLER, "03linkednostr");

    const plain = await app.request("http://localhost/api/auctions/a1");
    const auction = (await plain.json()) as Auction;
    expect(auction.seller_nostr_pubkey).toBe("03linkednostr");

    const withBids = await app.request("http://localhost/api/auctions/a1?with_bids=1");
    const combined = (await withBids.json()) as { auction: Auction; bids: Bid[] };
    expect(combined.auction.seller_nostr_pubkey).toBe("03linkednostr");
  });

  it("GET /api/auctions omits winner_nostr_pubkey (winner stays anonymous publicly)", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(
      makeAuction({ state: "SETTLED", winner_npub: BIDDER, winning_amount: 3600 }),
    );
    await db.saveNostrLink(BIDDER, "03winnerlink");

    const res = await app.request("http://localhost/api/auctions");
    const list = (await res.json()) as Auction[];
    expect(list[0]!.winner_nostr_pubkey).toBeUndefined();
  });

  it("GET /api/auctions omits winner_nostr_pubkey when the winner is not linked", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(
      makeAuction({ state: "SETTLED", winner_npub: BIDDER, winning_amount: 3600 }),
    );

    const res = await app.request("http://localhost/api/auctions");
    const list = (await res.json()) as Auction[];
    expect(list[0]!.winner_nostr_pubkey).toBeUndefined();
  });

  it("GET /api/auctions/:id omits winner_nostr_pubkey for anonymous viewers", async () => {
    const app = createApp(db, { serverKey: SERVER });
    await db.saveAuction(
      makeAuction({ state: "SETTLED", winner_npub: BIDDER, winning_amount: 3600 }),
    );
    await db.saveNostrLink(BIDDER, "03winnerlink");

    const plain = await app.request("http://localhost/api/auctions/a1");
    const auction = (await plain.json()) as Auction;
    expect(auction.winner_nostr_pubkey).toBeUndefined();

    const withBids = await app.request("http://localhost/api/auctions/a1?with_bids=1");
    const combined = (await withBids.json()) as { auction: Auction; bids: Bid[] };
    expect(combined.auction.winner_nostr_pubkey).toBeUndefined();
  });

  it("GET /api/auctions/:id reveals winner_nostr_pubkey to the seller only (signed)", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const seller = sellerKey();
    await db.saveAuction(
      makeAuction({
        state: "SETTLED",
        seller_pubkey: seller.pubkey,
        winner_npub: BIDDER,
        winning_amount: 3600,
      }),
    );
    await db.saveNostrLink(BIDDER, "03winnerlink");

    // Anonymous viewer: no winner link.
    const anon = (await (await app.request("http://localhost/api/auctions/a1")).json()) as Auction;
    expect(anon.winner_nostr_pubkey).toBeUndefined();

    // Seller-signed viewer: winner link is revealed.
    const sig = signSecret("winner-view:a1", seller.skHex);
    const sellerRes = await app.request(
      `http://localhost/api/auctions/a1?seller_pubkey=${seller.pubkey}&seller_sig=${sig}`,
    );
    const sellerView = (await sellerRes.json()) as Auction;
    expect(sellerView.winner_nostr_pubkey).toBe("03winnerlink");
  });

  it("GET /api/auctions/:id rejects a forged seller signature", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const seller = sellerKey();
    await db.saveAuction(
      makeAuction({
        state: "SETTLED",
        seller_pubkey: seller.pubkey,
        winner_npub: BIDDER,
        winning_amount: 3600,
      }),
    );
    await db.saveNostrLink(BIDDER, "03winnerlink");

    const forged = signSecret("winner-view:a1", bytesToHex(schnorr.utils.randomSecretKey()));
    const res = await app.request(
      `http://localhost/api/auctions/a1?seller_pubkey=${seller.pubkey}&seller_sig=${forged}`,
    );
    // Forged signature must not leak the winner: 401 + no winner link.
    expect(res.status).toBe(401);
    const body = (await res.json()) as Auction & { error?: string };
    expect(body.winner_nostr_pubkey).toBeUndefined();
  });
});
