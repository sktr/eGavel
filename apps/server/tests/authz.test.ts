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

/** Build a real seller keypair and a signed DELETE / GET shipping request. */
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

describe("GET /api/auctions/:id/shipping — Schnorr-signed seller auth", async () => {
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    db = initDb();
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  it("rejects reading shipping without a seller signature (INVALID_SIGNATURE)", async () => {
    const { pubkey } = sellerKey();
    await db.saveAuction(makeAuction({ state: "SETTLED", seller_pubkey: pubkey }));
    await db.saveShipping("a1", "Tokyo", null);
    const res = await app.request(
      `http://localhost/api/auctions/a1/shipping?seller_pubkey=${pubkey}`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
  });

  it("rejects reading shipping with the wrong key (INVALID_SIGNATURE)", async () => {
    const { pubkey } = sellerKey();
    const attacker = sellerKey();
    await db.saveAuction(makeAuction({ state: "SETTLED", seller_pubkey: pubkey }));
    await db.saveShipping("a1", "Tokyo", null);
    const sig = signSecret("shipping:a1", attacker.skHex);
    const res = await app.request(
      `http://localhost/api/auctions/a1/shipping?seller_pubkey=${pubkey}&seller_sig=${sig}`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
  });

  it("returns the stored shipping address to the signing seller", async () => {
    const { skHex, pubkey } = sellerKey();
    await db.saveAuction(makeAuction({ state: "SETTLED", seller_pubkey: pubkey }));
    await db.saveShipping("a1", "Tokyo", null);
    const sig = signSecret("shipping:a1", skHex);
    const res = await app.request(
      `http://localhost/api/auctions/a1/shipping?seller_pubkey=${pubkey}&seller_sig=${sig}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { address: string; note: string | null };
    expect(body.address).toBe("Tokyo");
  });
});
