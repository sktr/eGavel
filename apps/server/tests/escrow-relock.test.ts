import { describe, it, expect, vi } from "vitest";
vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  const { Amount } = actual as never as { Amount: { from(n:number): unknown } };
  function split(n:number): number[] { const o:number[]=[]; let r=n; for(let d=1; d<=r; ) { if(d<=r){o.push(d); r-=d; d<<=1;} else d>>=1; } return o.length?o:[n]; }
  return {
    ...(actual as object),
    Wallet: class {
      constructor(public mintUrl:string) {}
      async loadMint(){}
      keyChain={ getKeyset:(_id:string)=>({ id:_id, keys:{} }) };
      getFeesForProofs(){ return (Amount as unknown as { from(n:number):unknown }).from(0); }
      mint={ swap: async ({ outputs }:{ outputs: unknown[] })=>({ signatures: (outputs as unknown[]).map((_,i)=>({ C_: `sig${i}` })) }) };
      async checkProofsStates(proofs: unknown[]){ return (proofs as unknown[]).map(()=>({ state:"UNSPENT" })); }
    },
    OutputData: {
      createP2PKData: (opts:unknown, amount:number, _ks:unknown)=>{
        if(amount<=0) return [];
        return split(amount).map((d,i)=>({
          blindedMessage:{ amount:String(d), B_:`B${i}`, id:"ks1" },
          blindingFactor: BigInt(100+i),
          secret: new TextEncoder().encode(`relock-${d}-${i}`),
          toProof:(sig:unknown)=>({ id:"ks1", amount:d, secret:`relock-${d}-${i}`, C:`C${i}` }),
        }));
      },
      serialize:(o:{ blindedMessage:unknown; blindingFactor:bigint; secret:Uint8Array })=>({
        blindedMessage: o.blindedMessage, blindingFactor: String(o.blindingFactor), secret: new TextDecoder().decode(o.secret),
      }),
      deserialize:(s:{ blindedMessage:unknown; blindingFactor:string; secret:string })=>({
        blindedMessage: s.blindedMessage, blindingFactor: BigInt(s.blindingFactor), secret: new TextEncoder().encode(s.secret),
        toProof:(sig:unknown)=>({ id:"ks1", amount:1, secret:s.secret, C:"C" }),
      }),
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

describe("POST /auctions/:id/escrow/relock", () => {
  it("winner consent migrates Stage1 -> Stage2", async () => {
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:500, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    const secret=JSON.stringify(["P2PK",{ nonce:"n", data:"x", tags:[["pubkeys", seller.pk, winner.pk, server.pk]] }]);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:100 }], mint_url:"https://mint.example", amount:100 }), tracking_number:"EE473124829US", tracking_kind:"s10", migrated_at:null, created_at: Date.now() });
    const sellerSigs=[signSecret(secret, seller.sk)];
    const winnerSigs=[signSecret(secret, winner.sk)];
    const res=await app.request("http://localhost/api/auctions/a1/escrow/relock",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_sigs:sellerSigs, winner_sigs:winnerSigs }) });
    expect(res.status).toBe(200);
    const row=await db.getEscrow("a1");
    expect(row?.stage).toBe(2); expect(row?.status).toBe("active");
  });
  it("rejects without winner sig before 72h", async () => {
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), tracking_number:"EE473124829US", tracking_kind:"s10", migrated_at:null, created_at: Date.now() });
    const res=await app.request("http://localhost/api/auctions/a1/escrow/relock",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_sigs:["sig"] }) });
    expect(res.status).toBe(400);
  });
  it("server fallback after 72h without winner sig", async () => {
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    const secret=JSON.stringify(["P2PK",{ nonce:"n", data:"x", tags:[] }]);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:100 }], mint_url:"https://mint.example", amount:100 }), tracking_number:"EE473124829US", tracking_kind:"s10", migrated_at:null, created_at: Date.now() - 73*3600*1000 });
    const sellerSigs=[signSecret(secret, seller.sk)];
    const res=await app.request("http://localhost/api/auctions/a1/escrow/relock",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_sigs:sellerSigs }) });
    expect(res.status).toBe(200);
  });
  it("rejects when no tracking yet (400 NO_TRACKING)", async () => {
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data:"{}", tracking_number:null, tracking_kind:null, migrated_at:null, created_at: Date.now() });
    const res=await app.request("http://localhost/api/auctions/a1/escrow/relock",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_sigs:["s"] }) });
    expect(res.status).toBe(400);
  });
});
