import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  swapInputs: [] as Array<{ secret: string; witness: string }>,
  failLoadMint: false,
}));
vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  const { Amount } = actual as never as { Amount: { from(n:number):unknown } };
  return {
    ...(actual as object),
    Wallet: class {
      constructor(public mintUrl:string){}
      async loadMint(){ if (state.failLoadMint) throw new Error("mint unreachable"); }
      keyChain={ getKeyset:(_id:string)=>({ id:_id, keys:{} }) };
      getFeesForProofs(){ return (Amount as unknown as { from(n:number):unknown }).from(0); }
      mint={ swap: async ({inputs, outputs}:{inputs:Array<{secret:string;witness:string}>, outputs:unknown[]})=>{
        state.swapInputs = inputs;
        return { signatures:(outputs as unknown[]).map((_,i)=>({ C_:`sig${i}` })) };
      } };
    },
    OutputData: {
      createP2PKData: (opts:unknown, amount:number, _ks:unknown)=>{
        if(amount<=0) return [];
        return [{ blindedMessage:{ amount:String(amount), B_:"B", id:"ks1" }, blindingFactor:BigInt(1), secret: new TextEncoder().encode("confirm"), toProof:()=>({ id:"ks1", amount, secret:"confirm", C:"C" }) }];
      },
    },
  };
});
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret, verifySecretSignature } from "../src/lib/schnorr.js";
import type { Auction } from "@egavel/shared";
function kp(){ const sk=bytesToHex(schnorr.utils.randomSecretKey()); return { sk, pk:bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) }; }

describe("POST /auctions/:id/confirm", () => {
  it("winner confirms with per-secret sigs → real witnesses on swap, seller pending_receive, escrow deleted", async () => {
    state.swapInputs = []; state.failLoadMint = false;
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", shipped:1, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() });
    const res=await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: winner.pk, winner_sig: signSecret(`confirm:a1`, winner.sk), secrets:["s"], winner_sigs:[signSecret("s", winner.sk)] }) });
    expect(res.status).toBe(200);
    const body=await res.json() as Record<string,unknown>;
    expect(body.ok).toBe(true);
    expect(await db.getEscrow("a1")).toBeNull();
    const rec=await db.getPendingReceives(seller.pk);
    expect(rec.length).toBeGreaterThan(0);
    // Witnesses must be REAL signatures: winner sig verifies against the
    // winner's pubkey, server sig against the server's pubkey. A witness
    // fabricated by signing with a public key can never verify at the mint.
    expect(state.swapInputs.length).toBe(1);
    const wit = JSON.parse(state.swapInputs[0]!.witness) as { signatures: string[] };
    expect(verifySecretSignature(wit.signatures[0]!, "s", winner.pk)).toBe(true);
    const serverPk = bytesToHex(schnorr.getPublicKey(hexToBytes(server.sk)));
    expect(verifySecretSignature(wit.signatures[1]!, "s", serverPk)).toBe(true);
  });

  it("rejects when secrets/winner_sigs missing (400)", async () => {
    state.failLoadMint = false;
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", shipped:1, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() });
    const res=await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: winner.pk, winner_sig: signSecret(`confirm:a1`, winner.sk) }) });
    expect(res.status).toBe(400);
  });

  it("rejects per-secret signature by a non-winner key (400 INVALID_SIGNATURE)", async () => {
    state.failLoadMint = false;
    const seller=kp(), winner=kp(), attacker=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", shipped:1, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() });
    const res=await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: winner.pk, winner_sig: signSecret(`confirm:a1`, winner.sk), secrets:["s"], winner_sigs:[signSecret("s", attacker.sk)] }) });
    expect(res.status).toBe(400);
    const body=await res.json() as Record<string,unknown>;
    expect(body.error).toBe("INVALID_SIGNATURE");
  });

  it("keeps the escrow row when the mint is unreachable (500)", async () => {
    state.failLoadMint = true;
    try {
      const seller=kp(), winner=kp(), server=kp();
      const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
      await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
      await db.saveEscrow({ auction_id:"a1", shipped:1, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() });
      const res=await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: winner.pk, winner_sig: signSecret(`confirm:a1`, winner.sk), secrets:["s"], winner_sigs:[signSecret("s", winner.sk)] }) });
      expect(res.status).toBe(500);
      expect(await db.getEscrow("a1")).not.toBeNull();
    } finally { state.failLoadMint = false; }
  });

  it("retries persistence after the swap: transient DB failure still returns ok", async () => {
    state.swapInputs = []; state.failLoadMint = false;
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", shipped:1, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() });
    const original = db.savePendingReceive.bind(db);
    let attempts = 0;
    const spy = vi.spyOn(db, "savePendingReceive").mockImplementation(async (...args: Parameters<typeof original>) => {
      attempts++;
      if (attempts === 1) throw new Error("d1 transient");
      return original(...args);
    });
    try {
      const res=await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: winner.pk, winner_sig: signSecret(`confirm:a1`, winner.sk), secrets:["s"], winner_sigs:[signSecret("s", winner.sk)] }) });
      expect(res.status).toBe(200);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect((await db.getPendingReceives(seller.pk)).length).toBeGreaterThan(0);
      expect(await db.getEscrow("a1")).toBeNull();
    } finally { spy.mockRestore(); }
  });

  it("rejects non-winner (403 FORBIDDEN)", async () => {
    state.failLoadMint = false;
    const seller=kp(), winner=kp(), attacker=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", shipped:1, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() });
    const sig=signSecret(`confirm:a1`, attacker.sk);
    const res=await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: attacker.pk, winner_sig: sig, secrets:["s"], winner_sigs:[signSecret("s", attacker.sk)] }) });
    expect(res.status).toBe(403);
  });

  it("rejects when not shipped (400 NOT_SHIPPED)", async () => {
    state.failLoadMint = false;
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", shipped:0, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() });
    const sig=signSecret(`confirm:a1`, winner.sk);
    const res=await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: winner.pk, winner_sig: sig, secrets:["s"], winner_sigs:[signSecret("s", winner.sk)] }) });
    expect(res.status).toBe(400);
    const body=await res.json() as Record<string,unknown>;
    expect(body.error).toBe("NOT_SHIPPED");
  });

  it("second confirm after success finds no escrow (404 NO_ESCROW)", async () => {
    // Double-submit / retry race: once funds have been released the row is
    // gone, so a replayed confirm must be rejected rather than re-swapped.
    state.failLoadMint = false;
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", shipped:1, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() });
    const body = JSON.stringify({ winner_pubkey: winner.pk, winner_sig: signSecret(`confirm:a1`, winner.sk), secrets:["s"], winner_sigs:[signSecret("s", winner.sk)] });
    const first = await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body });
    expect(first.status).toBe(200);
    const second = await app.request("http://localhost/api/auctions/a1/confirm",{ method:"POST", headers:{ "Content-Type":"application/json" }, body });
    expect(second.status).toBe(404);
    const secondBody = await second.json() as Record<string,unknown>;
    expect(secondBody.error).toBe("NO_ESCROW");
    // and exactly one payout exists
    expect((await db.getPendingReceives(seller.pk)).length).toBe(1);
  });
});
