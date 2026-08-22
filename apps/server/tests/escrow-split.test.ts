import { describe, it, expect, vi } from "vitest";
vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  const { Amount } = actual as never as { Amount: { from(n:number):unknown } };
  return {
    ...(actual as object),
    Wallet: class { constructor(public m:string){} async loadMint(){} keyChain={ getKeyset:(_id:string)=>({ id:_id, keys:{} }) }; getFeesForProofs(){ return (Amount as unknown as { from(n:number):unknown }).from(0); } mint={ swap: async ({outputs}:{outputs:unknown[]})=>({ signatures:(outputs as unknown[]).map((_,i)=>({ C_:`sig${i}` })) }) }; },
    OutputData: { createP2PKData: (opts:unknown, amount:number, _ks:unknown)=> amount<=0?[]:[{ blindedMessage:{ amount:String(amount), B_:"B", id:"ks1" }, blindingFactor:BigInt(1), secret:new TextEncoder().encode("split"), toProof:()=>({ id:"ks1", amount, secret:"split", C:"C" }) }] },
  };
});
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret } from "../src/lib/schnorr.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Auction } from "@egavel/shared";
function kp(){ const sk=bytesToHex(schnorr.utils.randomSecretKey()); return { sk, pk:bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) }; }
function hashSplits(splits: unknown){ return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(splits)))); }

describe("POST /auctions/:id/escrow/split", () => {
  it("both parties agree -> split swap and status split_resolved", async () => {
    const seller=kp(), winner=kp(), server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    const secret=JSON.stringify(["P2PK",{ nonce:"n", data:"x", tags:[] }]);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data: JSON.stringify({ proofs:[{ keyset_id:"ks1", C:"c", secret, amount:100 }], mint_url:"https://mint.example", amount:100 }), tracking_number:"EE473124829US", tracking_kind:"s10", migrated_at:null, created_at: Date.now() });
    const splits=[{ pubkey: seller.pk, amount:60 }, { pubkey: winner.pk, amount:40 }];
    const h=hashSplits(splits);
    const sellerSig=signSecret(`split:a1:${h}`, seller.sk);
    const winnerSig=signSecret(`split:a1:${h}`, winner.sk);
    const secretSellerSig=signSecret(secret, seller.sk);
    const secretWinnerSig=signSecret(secret, winner.sk);
    const res=await app.request("http://localhost/api/auctions/a1/escrow/split",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ splits, seller_pubkey: seller.pk, seller_sig: sellerSig, winner_pubkey: winner.pk, winner_sig: winnerSig, seller_secret_sigs:[secretSellerSig], winner_secret_sigs:[secretWinnerSig] }) });
    expect(res.status).toBe(200);
    expect((await db.getEscrow("a1"))?.status).toBe("split_resolved");
  });
});
