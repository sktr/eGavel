import { describe, it, expect, beforeEach, vi } from "vitest";
// NOTE: vi.mock はファイル先頭でホイストされる。factory は inline で完結させる。
const feeState = vi.hoisted(() => ({ mode: "zero" as "zero" | "broken" }));
vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  const { Amount } = actual as never as { Amount: { from(n:number): unknown } };
  function split(n: number): number[] {
    const denoms: number[] = []; let p = 1; while (p <= n) { denoms.push(p); p <<= 1; }
    // 簡易分割: 貪欲法で denom 合計==n にする
    const out: number[] = []; let rem = n;
    for (let i = denoms.length - 1; i >= 0; i--) if (denoms[i]! <= rem) { out.push(denoms[i]!); rem -= denoms[i]!; }
    return out.length ? out : [n];
  }
  return {
    ...(actual as object),
    Wallet: class {
      constructor(public mintUrl: string) {}
      async loadMint() {}
      keyChain = { getKeyset: (_id: string) => ({ id: _id, keys: {} }) };
      getFeesForProofs() {
        // "broken": real-world cashu-ts shape drift returned a value that
        // Number() coerced to NaN, which silently zeroed seller_net and
        // skipped the escrow (test10 incident, 2026-08-25).
        if (feeState.mode === "broken") return { weird: "shape" } as unknown;
        return (Amount as unknown as { from(n:number): unknown }).from(0);
      }
      mint = {
        swap: async ({ outputs }: { outputs: unknown[] }) => ({
          signatures: (outputs as unknown[]).map((_, i) => ({ C_: `sig${i}`, amount: 1 })),
        }),
      };
    },
    OutputData: {
      createP2PKData: (opts: unknown, amount: number, _keyset: unknown) => {
        if (amount <= 0) return [];
        return split(amount).map((d, i) => ({
          blindedMessage: { amount: String(d), B_: `B${i}`, id: "ks1" },
          blindingFactor: BigInt(100 + i),
          secret: new TextEncoder().encode(`escrow-secret-${d}-${i}`),
          toProof: (sig: unknown) => ({ id: "ks1", amount: d, secret: `escrow-secret-${d}-${i}`, C: `C${i}`, witness: "w" }),
        }));
      },
    },
  };
});

import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb, type Db } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret } from "../src/lib/schnorr.js";

describe("claim pays the seller directly by default (escrow dormant)", () => {
  it("returns seller_proofs and creates NO escrow when escrowEnabled is unset", async () => {
    const { sk: sellerSk, pk: sellerPk } = sellerKey();
    const { sk: serverSk } = sellerKey();
    const db = initDb();
    const app = new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: serverSk, feeBps: 0 }));
    // NOTE: no escrowEnabled flag — direct pay is the default.
    const winnerPk = bytesToHex(schnorr.getPublicKey(hexToBytes(bytesToHex(schnorr.utils.randomSecretKey()))));
    const secret = JSON.stringify(["P2PK",{ nonce:"n1", data: sellerPk, tags:[["pubkeys", sellerPk],["n_sigs","1"],["locktime", String(Math.floor(Date.now()/1000)+3600)],["refund", winnerPk]]}]);
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:sellerPk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winnerPk, winning_amount:500, mint_url:"https://mint.example" } as Auction);
    await db.saveBid({ id:"a1-y", auction_id:"a1", max_amount:500, current_amount:500, bidder_npub:winnerPk, Y:"y", received_at:Date.now(), status:"verified", proof_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:500 }], mint_url:"https://mint.example", amount:500 }) } as Bid);
    const sig = signSecret(secret, sellerSk);
    const res = await app.request("http://localhost/api/auctions/a1/claim",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ secrets:[secret], seller_sigs:[sig] }) });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.escrowed).toBeUndefined();
    const proofs = body.seller_proofs as unknown[];
    expect(proofs.length).toBeGreaterThan(0);
    expect(await db.getEscrow("a1")).toBeNull();
  });
});

describe("claim without a server signing key", () => {
  it("fails fast with SERVER_NOT_CONFIGURED (503) instead of a generic swap failure", async () => {
    const { sk: sellerSk, pk: sellerPk } = sellerKey();
    const winnerPk = bytesToHex(schnorr.getPublicKey(hexToBytes(bytesToHex(schnorr.utils.randomSecretKey()))));
    const db = initDb();
    const app = new Hono();
    // No serverKey in config or env.
    delete process.env.SERVER_PRIVATE_KEY;
    app.route("/api", createAuctionRoutes(db, {}));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:sellerPk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winnerPk, winning_amount:500, mint_url:"https://mint.example" } as Auction);
    const secret = JSON.stringify(["P2PK",{ nonce:"n1", data: sellerPk, tags:[["pubkeys", sellerPk],["n_sigs","1"],["locktime", String(Math.floor(Date.now()/1000)+3600)],["refund", winnerPk]]}]);
    await db.saveBid({ id:"a1-y", auction_id:"a1", max_amount:500, current_amount:500, bidder_npub:winnerPk, Y:"y", received_at:Date.now(), status:"verified", proof_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:500 }], mint_url:"https://mint.example", amount:500 }) } as Bid);
    const sig = signSecret(secret, sellerSk);
    const res = await app.request("http://localhost/api/auctions/a1/claim",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ secrets:[secret], seller_sigs:[sig] }) });
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string,unknown>;
    expect(body.error).toBe("SERVER_NOT_CONFIGURED");
  });
});

import type { Auction, Bid } from "@egavel/shared";

function sellerKey() {
  const sk = bytesToHex(schnorr.utils.randomSecretKey());
  const pk = bytesToHex(schnorr.getPublicKey(hexToBytes(sk)));
  return { sk, pk };
}

describe("POST /auctions/:id/claim — escrow protected mode", () => {
  it("two-stage: sellerNet>0 creates Stage1 escrow and omits seller_proofs", async () => {
    const { sk: sellerSk, pk: sellerPk } = sellerKey();
    const { sk: serverSk } = sellerKey();
    const db = initDb();
    const app = new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: serverSk, escrowEnabled: true, feeBps: 0 }));
    const winnerPk = bytesToHex(schnorr.getPublicKey(hexToBytes(bytesToHex(schnorr.utils.randomSecretKey()))));
    const secret = JSON.stringify(["P2PK",{ nonce:"n1", data: sellerPk, tags:[["pubkeys", sellerPk],["n_sigs","1"],["locktime", String(Math.floor(Date.now()/1000)+3600)],["refund", winnerPk]]}]);
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:sellerPk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winnerPk, winning_amount:500, mint_url:"https://mint.example" } as Auction);
    await db.saveBid({ id:"a1-y", auction_id:"a1", max_amount:500, current_amount:500, bidder_npub:winnerPk, Y:"y", received_at:Date.now(), status:"verified", proof_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:500 }], mint_url:"https://mint.example", amount:500 }) } as Bid);
    const sig = signSecret(secret, sellerSk);
    const res = await app.request("http://localhost/api/auctions/a1/claim",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ secrets:[secret], seller_sigs:[sig] }) });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string,unknown>;
    expect(body.escrowed).toBe(true);
    expect(body).not.toHaveProperty("seller_proofs");
    const row = await db.getEscrow("a1");
    expect(row?.shipped).toBe(0);
  });
  it("two-stage: sellerNet==0 creates no escrow (degenerate, instant release)", async () => {
    const { sk: sellerSk, pk: sellerPk } = sellerKey();
    const { sk: serverSk } = sellerKey();
    const db = initDb();
    const app = new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: serverSk, escrowEnabled: true, feeBps: 10000 })); // 100% fee -> sellerNet 0
    const winnerPk = bytesToHex(schnorr.getPublicKey(hexToBytes(bytesToHex(schnorr.utils.randomSecretKey()))));
    const secret = JSON.stringify(["P2PK",{ nonce:"n1", data: sellerPk, tags:[["pubkeys", sellerPk],["n_sigs","1"],["locktime", String(Math.floor(Date.now()/1000)+3600)],["refund", winnerPk]]}]);
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:sellerPk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winnerPk, winning_amount:500, mint_url:"https://mint.example" } as Auction);
    await db.saveBid({ id:"a1-y", auction_id:"a1", max_amount:500, current_amount:500, bidder_npub:winnerPk, Y:"y", received_at:Date.now(), status:"verified", proof_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:500 }], mint_url:"https://mint.example", amount:500 }) } as Bid);
    const sig = signSecret(secret, sellerSk);
    const res = await app.request("http://localhost/api/auctions/a1/claim",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ secrets:[secret], seller_sigs:[sig] }) });
    expect(res.status).toBe(200);
    expect(await db.getEscrow("a1")).toBeNull();
    const body = await res.json() as Record<string, unknown>;
    // The client must be able to tell "no proceeds on purpose" from a bug.
    expect(body.degenerate).toBe(true);
  });

  it("escapes to the escrow branch even when the mint returns an unparseable fee shape", async () => {
    // Regression for the 2026-08-25 test10 incident: cashu-ts returned a
    // non-number fee shape in production, Number() produced NaN, sellerNet
    // became NaN, and the claim silently fell into the direct-pay branch
    // with EMPTY seller_proofs — the seller's proceeds vanished. An
    // unparseable fee must be treated as 0 so claims keep their protection
    // (an actually-unbalanced swap then fails loudly at the mint).
    feeState.mode = "broken";
    try {
      const { sk: sellerSk, pk: sellerPk } = sellerKey();
      const { sk: serverSk } = sellerKey();
      const db = initDb();
      const app = new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: serverSk, escrowEnabled: true, feeBps: 0 }));
      const winnerPk = bytesToHex(schnorr.getPublicKey(hexToBytes(bytesToHex(schnorr.utils.randomSecretKey()))));
      const secret = JSON.stringify(["P2PK",{ nonce:"n1", data: sellerPk, tags:[["pubkeys", sellerPk],["n_sigs","1"],["locktime", String(Math.floor(Date.now()/1000)+3600)],["refund", winnerPk]]}]);
      await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:sellerPk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winnerPk, winning_amount:400, mint_url:"https://mint.example" } as Auction);
      await db.saveBid({ id:"a1-y", auction_id:"a1", max_amount:500, current_amount:500, bidder_npub:winnerPk, Y:"y", received_at:Date.now(), status:"verified", proof_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:500 }], mint_url:"https://mint.example", amount:500 }) } as Bid);
      const sig = signSecret(secret, sellerSk);
      const res = await app.request("http://localhost/api/auctions/a1/claim",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ secrets:[secret], seller_sigs:[sig] }) });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.escrowed).toBe(true);
      const row = await db.getEscrow("a1");
      expect(row).not.toBeNull();
      expect(row!.shipped).toBe(0);
    } finally {
      feeState.mode = "zero";
    }
  });

  it("recovers from a transient DB write failure post-swap (retries, still succeeds)", async () => {
    const { sk: sellerSk, pk: sellerPk } = sellerKey();
    const { sk: serverSk } = sellerKey();
    const db = initDb();
    const app = new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: serverSk, escrowEnabled: true, feeBps: 0 }));
    const winnerPk = bytesToHex(schnorr.getPublicKey(hexToBytes(bytesToHex(schnorr.utils.randomSecretKey()))));
    const secret = JSON.stringify(["P2PK",{ nonce:"n1", data: sellerPk, tags:[["pubkeys", sellerPk],["n_sigs","1"],["locktime", String(Math.floor(Date.now()/1000)+3600)],["refund", winnerPk]]}]);
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:sellerPk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winnerPk, winning_amount:400, mint_url:"https://mint.example" } as Auction);
    await db.saveBid({ id:"a1-y", auction_id:"a1", max_amount:500, current_amount:500, bidder_npub:winnerPk, Y:"y", received_at:Date.now(), status:"verified", proof_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:500 }], mint_url:"https://mint.example", amount:500 }) } as Bid);
    // First saveChange attempt flakes — the swap has ALREADY succeeded at the
    // mint, so the route MUST retry rather than lose the outputs.
    const original = db.saveChange.bind(db);
    let calls = 0;
    const spy = vi.spyOn(db, "saveChange").mockImplementation(async (...args: Parameters<typeof original>) => {
      calls++;
      if (calls === 1) throw new Error("transient d1 blip");
      return original(...args);
    });
    try {
      const sig = signSecret(secret, sellerSk);
      const res = await app.request("http://localhost/api/auctions/a1/claim",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ secrets:[secret], seller_sigs:[sig] }) });
      expect(res.status).toBe(200);
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(await db.getEscrow("a1")).not.toBeNull();
      expect(await db.getChange("a1")).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("dumps ALL payout proofs to the log when persistence keeps failing post-swap", async () => {
    const { sk: sellerSk, pk: sellerPk } = sellerKey();
    const { sk: serverSk } = sellerKey();
    const db = initDb();
    const app = new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: serverSk, escrowEnabled: true, feeBps: 0 }));
    const winnerPk = bytesToHex(schnorr.getPublicKey(hexToBytes(bytesToHex(schnorr.utils.randomSecretKey()))));
    const secret = JSON.stringify(["P2PK",{ nonce:"n1", data: sellerPk, tags:[["pubkeys", sellerPk],["n_sigs","1"],["locktime", String(Math.floor(Date.now()/1000)+3600)],["refund", winnerPk]]}]);
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:sellerPk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winnerPk, winning_amount:500, mint_url:"https://mint.example" } as Auction);
    await db.saveBid({ id:"a1-y", auction_id:"a1", max_amount:500, current_amount:500, bidder_npub:winnerPk, Y:"y", received_at:Date.now(), status:"verified", proof_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:500 }], mint_url:"https://mint.example", amount:500 }) } as Bid);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(db, "saveEscrow").mockRejectedValue(new Error("db down"));
    try {
      const sig = signSecret(secret, sellerSk);
      const res = await app.request("http://localhost/api/auctions/a1/claim",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ secrets:[secret], seller_sigs:[sig] }) });
      expect(res.status).toBe(500);
      // The swap consumed the bid proofs — the ONLY recovery artifact is the
      // CRITICAL dump containing every output proof set.
      const dumped = errSpy.mock.calls.map((c) => c.join(" ")).find((t) => t.includes("CRITICAL"));
      expect(dumped).toBeTruthy();
      expect(dumped).toContain("escrowProofs");
      expect(dumped).toContain("winnerProofs");
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
