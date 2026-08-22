import { describe, it, expect, vi } from "vitest";
vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  const { Amount } = actual as never as { Amount: { from(n:number):unknown } };
  return {
    ...(actual as object),
    Wallet: class {
      constructor(public mintUrl:string){}
      async loadMint(){}
      keyChain={ getKeyset:(_id:string)=>({ id:_id, keys:{} }) };
      getFeesForProofs(){ return (Amount as unknown as { from(n:number):unknown }).from(0); }
      mint={ swap: async ({outputs}:{outputs:unknown[]})=>({ signatures:(outputs as unknown[]).map((_,i)=>({ C_:`sig${i}` })) }) };
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
import { signSecret } from "../src/lib/schnorr.js";
import type { Auction } from "@egavel/shared";
function kp(){ const sk=bytesToHex(schnorr.utils.randomSecretKey()); return { sk, pk:bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) }; }

describe("POST /auctions/:id/confirm-receipt", () => {
  it("winner confirms -> release to seller pending_receive", async () => {
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    const secret=JSON.stringify(["P2PK",{ nonce:"n", data:"x", tags:[] }]);
    await db.saveEscrow({ auction_id:"a1", stage:2, status:"active", proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:100 }], mint_url:"https://mint.example", amount:100 }), tracking_number:"EE473124829US", tracking_kind:"s10", migrated_at: Date.now(), created_at: Date.now() });
    const winnerSig=signSecret(`confirm:a1`, winner.sk);
    const secretSig=signSecret(secret, winner.sk);
    const res=await app.request("http://localhost/api/auctions/a1/confirm-receipt",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: winner.pk, winner_sig: winnerSig, secret_sigs:[secretSig] }) });
    expect(res.status).toBe(200);
    expect((await db.getEscrow("a1"))?.status).toBe("confirmed");
    const rec=await db.getPendingReceives(seller.pk);
    expect(rec.length).toBeGreaterThan(0);
  });
  it("rejects non-winner (403)", async () => {
    const seller=kp(), winner=kp(), attacker=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:2, status:"active", proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), tracking_number:"EE473124829US", tracking_kind:"s10", migrated_at: Date.now(), created_at: Date.now() });
    const sig=signSecret(`confirm:a1`, attacker.sk);
    const res=await app.request("http://localhost/api/auctions/a1/confirm-receipt",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ winner_pubkey: attacker.pk, winner_sig: sig, secret_sigs:["s"] }) });
    expect(res.status).toBe(403);
  });
});
