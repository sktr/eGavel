import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb, type Db } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret } from "../src/lib/schnorr.js";
import type { Auction } from "@egavel/shared";

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "a1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  };
}

/** Build a real seller keypair for signed DELETE requests. */
function sellerKey() {
  const skHex = bytesToHex(schnorr.utils.randomSecretKey());
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(skHex)));
  return { skHex, pubkey };
}

describe("DELETE /api/auctions/:id — Schnorr-signed seller auth", async () => {
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    db = initDb();
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  it("rejects a DELETE without a seller signature (INVALID_SIGNATURE)", async () => {
    const { pubkey } = sellerKey();
    await db.saveAuction(makeAuction({ state: "ACTIVE", seller_pubkey: pubkey }));
    const res = await app.request(
      `http://localhost/api/auctions/a1?seller_pubkey=${pubkey}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
    expect(await db.getAuction("a1")).not.toBeNull();
  });

  it("rejects a DELETE with a signature from the wrong key (INVALID_SIGNATURE)", async () => {
    const { pubkey } = sellerKey();
    const attacker = sellerKey();
    await db.saveAuction(makeAuction({ state: "ACTIVE", seller_pubkey: pubkey }));
    const sig = signSecret("delete:a1", attacker.skHex);
    const res = await app.request(
      `http://localhost/api/auctions/a1?seller_pubkey=${pubkey}&seller_sig=${sig}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
  });

  it("deletes a bid-less auction when the seller signs the auction id", async () => {
    const { skHex, pubkey } = sellerKey();
    await db.saveAuction(makeAuction({ state: "ACTIVE", seller_pubkey: pubkey }));
    const sig = signSecret("delete:a1", skHex);
    const res = await app.request(
      `http://localhost/api/auctions/a1?seller_pubkey=${pubkey}&seller_sig=${sig}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(await db.getAuction("a1")).toBeNull();
  });

  it("rejects a non-seller pubkey even with a valid signature (NOT_SELLER)", async () => {
    const { pubkey } = sellerKey();
    const other = sellerKey();
    await db.saveAuction(makeAuction({ state: "ACTIVE", seller_pubkey: pubkey }));
    const sig = signSecret("delete:a1", other.skHex);
    const res = await app.request(
      `http://localhost/api/auctions/a1?seller_pubkey=${other.pubkey}&seller_sig=${sig}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NOT_SELLER");
    expect(await db.getAuction("a1")).not.toBeNull();
  });
});

describe("GET /api/bids — Schnorr-signed bidder auth (SEC-2)", async () => {
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    db = initDb();
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  it("rejects reading a bidder's history without a bidder signature (INVALID_SIGNATURE)", async () => {
    const { pubkey } = sellerKey();
    const res = await app.request(
      `http://localhost/api/bids?bidder_pubkey=${pubkey}`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
  });

  it("rejects a bidder history request signed by the wrong key (INVALID_SIGNATURE)", async () => {
    const { pubkey } = sellerKey();
    const attacker = sellerKey();
    const sig = signSecret(`bids:${pubkey}`, attacker.skHex);
    const res = await app.request(
      `http://localhost/api/bids?bidder_pubkey=${pubkey}&bidder_sig=${sig}`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
  });

  it("returns the bid history to the signing bidder (own history only)", async () => {
    const { skHex, pubkey } = sellerKey();
    await db.saveAuction(makeAuction({ state: "ACTIVE", seller_pubkey: pubkey }));
    await app.request("http://localhost/api/bids", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auction_id: "a1",
        amount: 200,
        bidder_pubkey: pubkey,
        // minimal payload — processBid validates; a full signed bid is
        // exercised in process-bid.test.ts; here we only need one row back.
        mode: "pending",
      }),
    });
    const sig = signSecret(`bids:${pubkey}`, skHex);
    const res = await app.request(
      `http://localhost/api/bids?bidder_pubkey=${pubkey}&bidder_sig=${sig}`,
    );
    expect(res.status).toBe(200);
    const bids = (await res.json()) as Record<string, unknown>[];
    for (const b of bids) {
      expect(b).not.toHaveProperty("max_amount");
    }
  });
});
