import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb, type Db } from "../src/db/index.js";
import { validateClaim, computeClaimSplit } from "../src/claim.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret, verifySecretSignature } from "../src/lib/schnorr.js";
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
    state: "SETTLED",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: BIDDER,
    winning_amount: 500,
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
    current_amount: 500,
    bidder_npub: BIDDER,
    Y: "y",
    received_at: Date.now(),
    status: "verified",
    proof_data: JSON.stringify({
      proofs: [{ keyset_id: "ks1", C: "c", secret, amount: 500 }],
      mint_url: "https://mint.example",
      amount: 500,
    }),
    ...overrides,
  };
}

describe("validateClaim", async () => {
  it("accepts the seller for a settled auction with a winner", async () => {
    const result = validateClaim(makeAuction(), makeBid(), SELLER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.winningSecrets)).toBe(true);
      expect(result.winningSecrets.length).toBe(1);
    }
  });

  it("rejects a non-seller claimant", async () => {
    const result = validateClaim(makeAuction(), makeBid(), "02attacker");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_SELLER");
  });

  it("rejects when the auction is not settled", async () => {
    const result = validateClaim(makeAuction({ state: "ACTIVE" }), makeBid(), SELLER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_SETTLED");
  });

  it("rejects when there is no winner", async () => {
    const result = validateClaim(makeAuction({ winner_npub: null }), makeBid(), SELLER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NO_WINNER");
  });

  it("rejects when locktime has already passed", async () => {
    const bid = makeBid();
    const bundle = JSON.parse(bid.proof_data!) as {
      proofs: { secret: string }[];
    };
    // secret with locktime in the past
    bundle.proofs[0]!.secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n2",
        data: SELLER,
        tags: [
          ["pubkeys", SERVER, BIDDER],
          ["n_sigs", "2"],
          ["locktime", String(Math.floor(Date.now() / 1000) - 60)],
          ["refund", BIDDER],
        ],
      },
    ]);
    bid.proof_data = JSON.stringify(bundle);
    const result = validateClaim(makeAuction(), bid, SELLER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("CLAIM_EXPIRED");
  });

  it("rejects a winning bid with no proof_data (NO_PROOF)", async () => {
    const result = validateClaim(makeAuction(), makeBid({ proof_data: null }), SELLER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NO_PROOF");
  });

  it("rejects a winning bid with unparseable proof_data (INVALID_PROOF)", async () => {
    const result = validateClaim(makeAuction(), makeBid({ proof_data: "not-json" }), SELLER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INVALID_PROOF");
  });

  it("rejects a winning bid whose proof_data parses but has no secret (INVALID_PROOF)", async () => {
    const result = validateClaim(makeAuction(), makeBid({ proof_data: "{}" }), SELLER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INVALID_PROOF");
  });
});

describe("bid-list endpoints (max secrecy)", async () => {
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    db = initDb();
    await db.saveAuction(makeAuction({ state: "ACTIVE" }));
    await db.saveBid(makeBid()); // verified leader, max_amount 500
    await db.saveBid({
      ...makeBid({ id: "a1-y2", bidder_npub: "05outbid", status: "outbid" }),
      current_amount: 310,
    });
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  it("never exposes max_amount, Y, or proof_data on /auctions/:id/bids", async () => {
    const res = await app.request("http://localhost/api/auctions/a1/bids");
    expect(res.status).toBe(200);
    const bids = (await res.json()) as Record<string, unknown>[];
    expect(bids.length).toBeGreaterThan(0);
    for (const b of bids) {
      expect(b).not.toHaveProperty("max_amount");
      expect(b).not.toHaveProperty("Y");
      expect(b).not.toHaveProperty("proof_data");
      expect(typeof b.current_amount).toBe("number");
    }
  });

  it("never exposes max_amount on /bids (own bid history)", async () => {
    // SEC-2: /bids requires a Schnorr signature from the bidder.
    const skHex = bytesToHex(schnorr.utils.randomSecretKey());
    const bidderPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(skHex)));
    const sig = signSecret(`bids:${bidderPubkey}`, skHex);
    const res = await app.request(
      `http://localhost/api/bids?bidder_pubkey=${bidderPubkey}&bidder_sig=${sig}`,
    );
    expect(res.status).toBe(200);
    const bids = (await res.json()) as Record<string, unknown>[];
    for (const b of bids) {
      expect(b).not.toHaveProperty("max_amount");
    }
  });
});

describe("POST /api/auctions (create listing, HTTP-direct)", async () => {
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    db = initDb();
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      item: "test item",
      description: "desc",
      start_price: 100,
      end_time: Date.now() + 3600_000,
      seller_pubkey: SELLER,
      mint_url: "https://mint.example",
      ...overrides,
    };
  }

  it("creates an auction with a generated id and saves it to the DB", async () => {
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(200);
    const auction = (await res.json()) as Auction;
    expect(auction.id).toMatch(new RegExp(`^${SELLER}-`));
    expect(auction.state).toBe("ACTIVE");
    expect(auction.seller_pubkey).toBe(SELLER);
    expect(auction.start_price).toBe(100);
    expect((await db.getAuction(auction.id))?.item).toBe("test item");
  });

  it("passes through optional fields (reserve, buy-now, category, image)", async () => {
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        validBody({
          reserve_price: 500,
          buy_now_price: 1000,
          category: "art",
          condition: "New",
          shipping: "home delivery",
          image: "https://example.com/x.webp",
        }),
      ),
    });
    expect(res.status).toBe(200);
    const auction = (await res.json()) as Auction;
    expect(auction.reserve_price).toBe(500);
    expect(auction.buy_now_price).toBe(1000);
    expect(auction.category).toBe("art");
    expect(auction.shipping).toBe("home delivery");
    expect(auction.image).toBe("https://example.com/x.webp");
  });

  it("rejects invalid input (missing item / bad price / past end / no seller)", async () => {
    const bad = [
      validBody({ item: "" }),
      validBody({ description: "" }),
      validBody({ start_price: 0 }),
      validBody({ end_time: Date.now() - 1000 }),
      validBody({ seller_pubkey: "" }),
      validBody({ mint_url: "" }),
    ];
    for (const body of bad) {
      const res = await app.request("http://localhost/api/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("POST /api/auctions/:id/shipping (Schnorr-signed payload)", async () => {
  let db: Db;
  let app: Hono;
  let winnerSkHex: string;
  let winnerPubkey: string;

  beforeEach(async () => {
    db = initDb();
    winnerSkHex = bytesToHex(schnorr.utils.randomSecretKey());
    winnerPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(winnerSkHex)));
    await db.saveAuction(makeAuction({ state: "SETTLED", winner_npub: winnerPubkey }));
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  function shippingBody(address: string, note: string | null, skHex: string, pubkey: string) {
    const content = JSON.stringify({ auction_id: "a1", address, note });
    return {
      auction_id: "a1",
      address,
      note,
      pubkey,
      sig: signSecret(content, skHex),
    };
  }

  it("accepts a Schnorr-signed shipping payload from the winner", async () => {
    const res = await app.request("http://localhost/api/auctions/a1/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shippingBody("Tokyo", null, winnerSkHex, winnerPubkey)),
    });
    expect(res.status).toBe(200);
    expect((await db.getShipping("a1"))?.address).toBe("Tokyo");
  });

  it("rejects a signature from a non-winner (NOT_WINNER)", async () => {
    const otherSkHex = bytesToHex(schnorr.utils.randomSecretKey());
    const otherPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(otherSkHex)));
    const res = await app.request("http://localhost/api/auctions/a1/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shippingBody("Osaka", null, otherSkHex, otherPubkey)),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NOT_WINNER");
  });

  it("rejects a tampered payload (INVALID_SIGNATURE)", async () => {
    const body = shippingBody("Tokyo", null, winnerSkHex, winnerPubkey);
    body.address = "Hacked"; // tampered payload
    const res = await app.request("http://localhost/api/auctions/a1/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { error: string };
    expect(parsed.error).toBe("INVALID_SIGNATURE");
  });
});

describe("POST /api/auctions/:id/claim — swap failure never leaks internals", async () => {
  let db: Db;
  let app: Hono;
  let sellerSkHex: string;
  let sellerPubkey: string;

  beforeEach(async () => {
    db = initDb();
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
    sellerSkHex = bytesToHex(schnorr.utils.randomSecretKey());
    sellerPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(sellerSkHex)));
  });

  it("returns a generic 500 message when the claim swap fails (no server key)", async () => {
    // A settled auction with a winning bid whose proofs exist server-side.
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "claim-err",
        data: sellerPubkey,
        tags: [
          ["pubkeys", "04server", BIDDER],
          ["n_sigs", "2"],
          ["locktime", String(Math.floor(Date.now() / 1000) + 3600)],
          ["refund", BIDDER],
        ],
      },
    ]);
    await db.saveAuction(
      makeAuction({
        state: "SETTLED",
        seller_pubkey: sellerPubkey,
        winner_npub: BIDDER,
        winning_amount: 500,
      }),
    );
    await db.saveBid({
      id: "a1-y",
      auction_id: "a1",
      max_amount: 500,
      current_amount: 500,
      bidder_npub: BIDDER,
      Y: "y",
      received_at: Date.now(),
      status: "verified",
      proof_data: JSON.stringify({
        proofs: [{ keyset_id: "ks1", C: "c", secret, amount: 500 }],
        mint_url: "https://mint.example",
        amount: 500,
      }),
    });

    const sellerSig = signSecret(secret, sellerSkHex);
    const res = await app.request("http://localhost/api/auctions/a1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secrets: [secret],
        seller_sigs: [sellerSig],
      }),
    });

    // The swap cannot run without a server key → 500 with a generic message.
    // The response must never contain server internals ("server key not
    // configured", stack traces, mint URLs).
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("claim swap failed");
    expect(body.error).not.toMatch(/server key|not configured|mint\.example/i);
  });
});

describe("lazy settle on read", async () => {
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    db = initDb();
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  it("settles a past-due auction when it is fetched", async () => {
    await db.saveAuction(makeAuction({ state: "ACTIVE", end_time: Date.now() - 60_000 }));
    const res = await app.request("http://localhost/api/auctions/a1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Auction;
    expect(body.state).toBe("SETTLED");
  });

  it("with_bids=1 returns auction + verified bids in one response", async () => {
    await db.saveAuction(makeAuction({ id: "a2", state: "ACTIVE", end_time: Date.now() + 3600_000 }));
    await db.saveBid(
      makeBid({
        id: "a2-y",
        auction_id: "a2",
        status: "verified",
        current_amount: 500,
        max_amount: 500,
      }),
    );
    const res = await app.request("http://localhost/api/auctions/a2?with_bids=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auction: Auction; bids: unknown[] };
    expect(body.auction.id).toBe("a2");
    expect(body.bids).toHaveLength(1);
    const b = body.bids[0] as { id: string; max_amount?: number };
    expect(b.id).toBe("a2-y");
    expect(b.max_amount).toBeUndefined(); // max secrecy preserved in combined read
  });

  it("settles past-due auctions in the list, leaving live ones active", async () => {
    await db.saveAuction(makeAuction({ id: "a1", state: "ACTIVE", end_time: Date.now() - 60_000 }));
    await db.saveAuction(
      makeAuction({ id: "a2", state: "ACTIVE", end_time: Date.now() + 3600_000 }),
    );
    const res = await app.request("http://localhost/api/auctions");
    const body = (await res.json()) as Auction[];
    expect(body.find((a) => a.id === "a1")!.state).toBe("SETTLED");
    expect(body.find((a) => a.id === "a2")!.state).toBe("ACTIVE");
  });
});

describe("change-return route", async () => {
  let db: Db;
  let app: Hono;

  beforeEach(async () => {
    db = initDb();
    process.env.SERVER_PRIVATE_KEY = "ab".repeat(32);
    await db.saveAuction(makeAuction({ state: "SETTLED", winner_npub: BIDDER }));
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  afterEach(async () => {
    delete process.env.SERVER_PRIVATE_KEY;
  });

  it("returns the stored change proofs to the winner", async () => {
    await db.saveChange(
      "a1",
      BIDDER,
      200,
      JSON.stringify([{ keyset_id: "ks1", C: "c", secret: "s", amount: 200 }]),
    );
    const res = await app.request(
      `http://localhost/api/auctions/a1/change?bidder_pubkey=${BIDDER}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proofs: unknown[]; amount: number; mint_url: string };
    expect(body.amount).toBe(200);
    expect(body.proofs).toHaveLength(1);
    expect(body.mint_url).toBe("https://mint.example");
  });

  it("rejects a non-winner requesting the change", async () => {
    await db.saveChange(
      "a1",
      BIDDER,
      200,
      JSON.stringify([{ keyset_id: "ks1", C: "c", secret: "s", amount: 200 }]),
    );
    const res = await app.request(
      "http://localhost/api/auctions/a1/change?bidder_pubkey=02attacker",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NOT_BIDDER");
  });

  it("returns NOT_CLAIMED before the seller claims (auto-collect keeps polling)", async () => {
    const res = await app.request(
      `http://localhost/api/auctions/a1/change?bidder_pubkey=${BIDDER}`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NOT_CLAIMED");
  });

  it("returns NO_CHANGE once claimed with no change output (permanent — stop polling)", async () => {
    await db.markClaimed("a1");
    const res = await app.request(
      `http://localhost/api/auctions/a1/change?bidder_pubkey=${BIDDER}`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NO_CHANGE");
  });
});

describe("DELETE /api/auctions/:id (seller removes a bid-less listing)", async () => {
  let db: Db
  let app: Hono
  let sellerSkHex: string
  let sellerPubkey: string

  beforeEach(async () => {
    db = initDb()
    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
    sellerSkHex = bytesToHex(schnorr.utils.randomSecretKey())
    sellerPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(sellerSkHex)))
  })

  function deleteUrl(id = "a1") {
    const sig = signSecret(`delete:${id}`, sellerSkHex)
    return `http://localhost/api/auctions/${id}?seller_pubkey=${sellerPubkey}&seller_sig=${sig}`
  }

  it("lets the seller delete an active auction with no bids", async () => {
    await db.saveAuction(makeAuction({ state: "ACTIVE", seller_pubkey: sellerPubkey }))
    const res = await app.request(deleteUrl(), { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(await db.getAuction("a1")).toBeNull()
  })

  it("rejects a non-seller (NOT_SELLER)", async () => {
    await db.saveAuction(makeAuction({ state: "ACTIVE", seller_pubkey: sellerPubkey }))
    const res = await app.request(
      "http://localhost/api/auctions/a1?seller_pubkey=02attacker",
      { method: "DELETE" },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("NOT_SELLER")
  })

  it("rejects deletion once bids exist (HAS_BIDS)", async () => {
    await db.saveAuction(makeAuction({ state: "ACTIVE", seller_pubkey: sellerPubkey }))
    await db.saveBid({
      id: "b1",
      auction_id: "a1",
      max_amount: 500,
      current_amount: 210,
      bidder_npub: "03cafebabe",
      Y: "Y-1",
      received_at: Date.now(),
      status: "verified",
      proof_data: null,
    })
    const res = await app.request(deleteUrl(), { method: "DELETE" })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("HAS_BIDS")
    expect(await db.getAuction("a1")).not.toBeNull()
  })
})

describe("computeClaimSplit (proxy-bidding change return)", async () => {
  it("splits locked max into seller, fee, and winner change", async () => {
    // locked 1000 (the max), winning 800, 5% fee, 1 sat mint fee
    const split = computeClaimSplit(1000, 800, 500, 1);
    expect(split).toEqual({ sellerNet: 759, fee: 40, change: 200, reserveFee: 1 });
    expect(split.sellerNet + split.fee + split.change + split.reserveFee).toBe(1000);
  });

  it("no change when the winner locked exactly the winning amount", async () => {
    const split = computeClaimSplit(500, 500, 500, 1);
    expect(split.change).toBe(0);
    expect(split.sellerNet + split.fee + split.change + split.reserveFee).toBe(500);
  });

  it("buy-now: returns the excess above buy_now_price to the winner", async () => {
    // locked 1500, winning (buy-now) 1000, 5% fee, 1 sat mint fee
    const split = computeClaimSplit(1500, 1000, 500, 1);
    expect(split).toEqual({ sellerNet: 949, fee: 50, change: 500, reserveFee: 1 });
    expect(split.sellerNet + split.fee + split.change + split.reserveFee).toBe(1500);
  });

  it("never returns negative change", async () => {
    const split = computeClaimSplit(100, 500, 500, 1); // defensive: winning > locked
    expect(split.change).toBe(0);
    expect(split.sellerNet).toBeGreaterThanOrEqual(0);
  });

  it("reserves exactly the mint fee, not a hardcoded 1 sat", async () => {
    // A fee-free mint (input_fee_ppk = 0) must receive the full winning
    // amount, otherwise the swap is unbalanced: NUT-02 requires
    // sum(inputs) - fees == sum(outputs), and with expected_fee 0 the mint
    // rejects a 1-sat shortfall (CDK error 11005 TransactionUnbalanced).
    const split = computeClaimSplit(8, 8, 500, 0);
    expect(split).toEqual({ sellerNet: 8, fee: 0, change: 0, reserveFee: 0 });
    expect(split.sellerNet + split.fee + split.change + split.reserveFee).toBe(8);
  });

  it("reserves more than 1 sat when the mint charges more", async () => {
    // 11+ inputs on a 100 ppk keyset costs 2 sat (NUT-02 ceil rounding);
    // sellerNet must shrink so the swap stays balanced.
    const split = computeClaimSplit(1000, 800, 500, 2);
    expect(split).toEqual({ sellerNet: 758, fee: 40, change: 200, reserveFee: 2 });
    expect(split.sellerNet + split.fee + split.change + split.reserveFee).toBe(1000);
  });
});

describe("co-sign route", async () => {
  let db: Db;
  let app: Hono;
  let sellerSk: Uint8Array;
  let sellerPubkey: string;
  let serverSkHex: string;
  let serverPubkeyXOnly: string;

  beforeEach(async () => {
    db = initDb();
    sellerSk = schnorr.utils.randomSecretKey();
    sellerPubkey = bytesToHex(schnorr.getPublicKey(sellerSk));
    serverSkHex = bytesToHex(schnorr.utils.randomSecretKey());
    serverPubkeyXOnly = bytesToHex(schnorr.getPublicKey(hexToBytes(serverSkHex)));
    process.env.SERVER_PRIVATE_KEY = serverSkHex;

    const auction = makeAuction({
      seller_pubkey: sellerPubkey,
      state: "SETTLED",
      winner_npub: BIDDER,
    });
    await db.saveAuction(auction);
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "route1",
        data: sellerPubkey,
        tags: [
          ["pubkeys", SERVER, BIDDER],
          ["n_sigs", "2"],
          ["locktime", String(Math.floor(Date.now() / 1000) + 3600)],
          ["refund", BIDDER],
        ],
      },
    ]);
    await db.saveBid({
      id: "a1-y",
      auction_id: "a1",
      max_amount: 500,
      current_amount: 500,
      bidder_npub: BIDDER,
      Y: "y",
      received_at: Date.now(),
      status: "verified",
      proof_data: JSON.stringify({
        proofs: [{ keyset_id: "ks1", C: "c", secret, amount: 500 }],
        mint_url: "https://mint.example",
        amount: 500,
      }),
    });

    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
  });

  afterEach(async () => {
    delete process.env.SERVER_PRIVATE_KEY;
  });

  it("co-signs the winning secret with a valid seller signature", async () => {
    const bundle = JSON.parse((await db.getBid("a1-y"))!.proof_data!) as {
      proofs: { secret: string }[];
    };
    const winningSecret = bundle.proofs[0]!.secret;
    const sellerSig = signSecret(winningSecret, Buffer.from(sellerSk).toString("hex"));
    const res = await app.request("http://localhost/api/auctions/a1/co-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets: [winningSecret], seller_sigs: [sellerSig] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { server_sigs: string[] };
    expect(body.server_sigs).toHaveLength(1);
    expect(verifySecretSignature(body.server_sigs[0]!, winningSecret, serverPubkeyXOnly)).toBe(
      true,
    );
  });

  it("rejects a wrong secret with INVALID_MSG", async () => {
    const bundle = JSON.parse((await db.getBid("a1-y"))!.proof_data!) as {
      proofs: { secret: string }[];
    };
    const winningSecret = bundle.proofs[0]!.secret;
    const sellerSig = signSecret(winningSecret, Buffer.from(sellerSk).toString("hex"));
    const res = await app.request("http://localhost/api/auctions/a1/co-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets: ["not-the-winning-secret"], seller_sigs: [sellerSig] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_MSG");
  });
});
