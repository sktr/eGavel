import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb, type Db } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret } from "../src/lib/schnorr.js";
import type { Auction, Bid } from "@egavel/shared";

const SELLER = "02deadbeef";
const SERVER = "04server";
const SERVER_SK = "11".repeat(32); // 64-hex server key
const BIDDER_SK = "22".repeat(32); // 64-hex bidder key
const BIDDER = bytesToHex(schnorr.getPublicKey(hexToBytes(BIDDER_SK))); // x-only

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
  const secret = JSON.stringify([
    "P2PK",
    {
      nonce: "n1",
      data: SELLER,
      tags: [
        ["pubkeys", SERVER, BIDDER],
        ["n_sigs", "2"],
        ["locktime", String(Math.floor(Date.now() / 1000) + 3600)],
        ["refund", BIDDER],
      ],
    },
  ]);
  return {
    id: "a1-y",
    auction_id: "a1",
    max_amount: 500,
    current_amount: 100,
    bidder_npub: BIDDER,
    Y: "y",
    received_at: Date.now(),
    status: "pending",
    proof_data: JSON.stringify({
      proofs: [{ keyset_id: "ks1", C: "c", secret, amount: 500 }],
      mint_url: "https://mint.example",
      amount: 500,
    }),
    ...overrides,
  };
}

function app(db: Db) {
  const a = new Hono();
  a.route("/api", createAuctionRoutes(db, { serverKey: SERVER_SK }));
  return a;
}

describe("pending bid refund endpoints", () => {
  let db: Db;
  beforeEach(() => {
    db = initDb();
  });

  async function seedBid(overrides: Partial<Bid> = {}) {
    await db.saveAuction(makeAuction());
    await db.saveBid(makeBid(overrides));
  }

  it("refund-data returns the bundle for a pending bid", async () => {
    await seedBid();
    const res = await app(db).request(
      `http://localhost/api/bids/a1-y/refund-data?bidder_pubkey=${BIDDER}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proofs: unknown[] };
    expect(body.proofs).toHaveLength(1);
  });

  it("refund-co-sign signs for a pending bid", async () => {
    await seedBid();
    const bid = (await db.getBid("a1-y"))!;
    const secret = (JSON.parse(bid.proof_data!) as { proofs: { secret: string }[] })
      .proofs[0]!.secret;
    const sig = signSecret(secret, BIDDER_SK);
    const res = await app(db).request("http://localhost/api/bids/a1-y/refund-co-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets: [secret], bidder_sigs: [sig] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { server_sigs: unknown[] };
    expect(body.server_sigs).toHaveLength(1);
  });

  it("refunded confirmation accepts pending and flips the status", async () => {
    await seedBid();
    const res = await app(db).request(
      `http://localhost/api/bids/a1-y/refunded?bidder_pubkey=${BIDDER}`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect((await db.getBid("a1-y"))!.status).toBe("refunded");
  });

  it("refund-data still rejects verified bids (NOT_OUTBID)", async () => {
    await seedBid({ status: "verified" });
    const res = await app(db).request(
      `http://localhost/api/bids/a1-y/refund-data?bidder_pubkey=${BIDDER}`,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("NOT_OUTBID");
  });
});
