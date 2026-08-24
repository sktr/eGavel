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
        return [{ blindedMessage:{ amount:String(amount), B_:"B", id:"ks1" }, blindingFactor:BigInt(1), secret: new TextEncoder().encode("release"), toProof:()=>({ id:"ks1", amount, secret:"release", C:"C" }) }];
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
import { ESCROW_TIMEOUT_MS } from "../src/lib/escrow.js";
import type { Auction } from "@egavel/shared";
function kp(){ const sk=bytesToHex(schnorr.utils.randomSecretKey()); return { sk, pk:bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) }; }

async function setup(shipped: number, createdAtOffsetMs = -ESCROW_TIMEOUT_MS - 1000) {
  const seller=kp(), winner=kp(), server=kp();
  const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
  await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
  await db.saveEscrow({ auction_id:"a1", shipped, proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret:"s", amount:100 }], mint_url:"https://mint.example", amount:100 }), created_at: Date.now() + createdAtOffsetMs });
  return { seller, winner, server, db, app };
}

describe("POST /auctions/:id/release", () => {
  it("seller releases after timeout when shipped → seller pending_receive, escrow deleted", async () => {
    const { seller, app, db } = await setup(1);
    const sellerSig=signSecret(`release:a1`, seller.sk);
    // Per-secret signatures: the seller's client signs every escrow proof secret
    // (fetched via GET /escrow) — these become the 2-of-3 witnesses with the server's.
    const res=await app.request("http://localhost/api/auctions/a1/release",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_pubkey: seller.pk, seller_sig: sellerSig, secrets:["s"], seller_sigs:[signSecret("s", seller.sk)] }) });
    expect(res.status).toBe(200);
    const body=await res.json() as Record<string,unknown>;
    expect(body.ok).toBe(true);
    expect(body.amount).toBe(100);
    expect(await db.getEscrow("a1")).toBeNull();
    const rec=await db.getPendingReceives(seller.pk);
    expect(rec.length).toBeGreaterThan(0);
  });

  it("rejects per-secret signature by a non-seller key (400 INVALID_SIGNATURE)", async () => {
    const { seller, winner, app } = await setup(1);
    const res=await app.request("http://localhost/api/auctions/a1/release",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_pubkey: seller.pk, seller_sig: signSecret(`release:a1`, seller.sk), secrets:["s"], seller_sigs:[signSecret("s", winner.sk)] }) });
    expect(res.status).toBe(400);
    const body=await res.json() as Record<string,unknown>;
    expect(body.error).toBe("INVALID_SIGNATURE");
  });

  it("rejects before timeout (400 NOT_EXPIRED)", async () => {
    const { seller, app } = await setup(1, -1000);
    const sig=signSecret(`release:a1`, seller.sk);
    const res=await app.request("http://localhost/api/auctions/a1/release",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_pubkey: seller.pk, seller_sig: sig, secrets:["s"], seller_sigs:[signSecret("s", seller.sk)] }) });
    expect(res.status).toBe(400);
    const body=await res.json() as Record<string,unknown>;
    expect(body.error).toBe("NOT_EXPIRED");
  });

  it("rejects non-seller (403)", async () => {
    const { winner, app } = await setup(1);
    const sig=signSecret(`release:a1`, winner.sk);
    const res=await app.request("http://localhost/api/auctions/a1/release",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_pubkey: winner.pk, seller_sig: sig, secrets:["s"], seller_sigs:[signSecret("s", winner.sk)] }) });
    expect(res.status).toBe(403);
  });

  it("rejects when not shipped (400 NOT_SHIPPED)", async () => {
    const { seller, app } = await setup(0);
    const sig=signSecret(`release:a1`, seller.sk);
    const res=await app.request("http://localhost/api/auctions/a1/release",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ seller_pubkey: seller.pk, seller_sig: sig, secrets:["s"], seller_sigs:[signSecret("s", seller.sk)] }) });
    expect(res.status).toBe(400);
    const body=await res.json() as Record<string,unknown>;
    expect(body.error).toBe("NOT_SHIPPED");
  });
});
