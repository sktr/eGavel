import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb, type Db } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret } from "../src/lib/schnorr.js";
import type { Auction } from "@egavel/shared";

function kp() {
  const sk = bytesToHex(schnorr.utils.randomSecretKey());
  return { sk, pk: bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) };
}

function auction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "a1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "SETTLED",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  };
}

describe("POST /auctions/:id/shipped", () => {
  let db: Db;
  beforeEach(() => { db = initDb(); });

  it("seller marks as shipped → shipped=1", async () => {
    const seller = kp();
    const app = new Hono();
    app.route("/api", createAuctionRoutes(db, { serverKey: kp().sk }));
    await db.saveAuction(auction({ seller_pubkey: seller.pk }));
    await db.saveEscrow({
      auction_id: "a1",
      shipped: 0,
      proofs_data: JSON.stringify({ proofs: [{ secret: "s" }], amount: 100 }),
      created_at: Date.now(),
    });
    const sig = signSecret("shipped:a1", seller.sk);
    const res = await app.request("http://localhost/api/auctions/a1/shipped", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_pubkey: seller.pk, seller_sig: sig }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect((await db.getEscrow("a1"))?.shipped).toBe(1);
  });

  it("rejects non-seller (403)", async () => {
    const seller = kp();
    const attacker = kp();
    const app = new Hono();
    app.route("/api", createAuctionRoutes(db, { serverKey: kp().sk }));
    await db.saveAuction(auction({ seller_pubkey: seller.pk }));
    await db.saveEscrow({
      auction_id: "a1",
      shipped: 0,
      proofs_data: "{}",
      created_at: Date.now(),
    });
    const sig = signSecret("shipped:a1", attacker.sk);
    const res = await app.request("http://localhost/api/auctions/a1/shipped", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_pubkey: attacker.pk, seller_sig: sig }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects when already shipped (400 ALREADY_SHIPPED)", async () => {
    const seller = kp();
    const app = new Hono();
    app.route("/api", createAuctionRoutes(db, { serverKey: kp().sk }));
    await db.saveAuction(auction({ seller_pubkey: seller.pk }));
    await db.saveEscrow({
      auction_id: "a1",
      shipped: 1,
      proofs_data: "{}",
      created_at: Date.now(),
    });
    const sig = signSecret("shipped:a1", seller.sk);
    const res = await app.request("http://localhost/api/auctions/a1/shipped", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_pubkey: seller.pk, seller_sig: sig }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("ALREADY_SHIPPED");
  });

  it("rejects when no escrow exists (404 NO_ESCROW)", async () => {
    const seller = kp();
    const app = new Hono();
    app.route("/api", createAuctionRoutes(db, { serverKey: kp().sk }));
    await db.saveAuction(auction({ seller_pubkey: seller.pk }));
    const sig = signSecret("shipped:a1", seller.sk);
    const res = await app.request("http://localhost/api/auctions/a1/shipped", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_pubkey: seller.pk, seller_sig: sig }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("NO_ESCROW");
  });
});
