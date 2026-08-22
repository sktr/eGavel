import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret } from "../src/lib/schnorr.js";
import type { Auction } from "@egavel/shared";
function kp(){ const sk=bytesToHex(schnorr.utils.randomSecretKey()); return { sk, pk: bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) }; }

describe("POST /auctions/:id/tracking", () => {
  it("seller reports valid S10 -> stored", async () => {
    const seller=kp(); const winner=kp(); const server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data:"{}", tracking_number:null, tracking_kind:null, migrated_at:null, created_at: Date.now() });
    const sig=signSecret(`tracking:a1:EE473124829US`, seller.sk);
    const res=await app.request("http://localhost/api/auctions/a1/tracking",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ tracking_number:"EE473124829US", seller_pubkey:seller.pk, seller_sig:sig }) });
    expect(res.status).toBe(200);
    expect((await db.getEscrow("a1"))?.tracking_kind).toBe("s10");
  });
  it("rejects invalid format (400 INVALID_TRACKING)", async () => {
    const seller=kp(); const winner=kp(); const server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data:"{}", tracking_number:null, tracking_kind:null, migrated_at:null, created_at: Date.now() });
    const sig=signSecret(`tracking:a1:BAD`, seller.sk);
    const res=await app.request("http://localhost/api/auctions/a1/tracking",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ tracking_number:"BAD", seller_pubkey:seller.pk, seller_sig:sig }) });
    expect(res.status).toBe(400); expect((await res.json() as {error:string}).error).toBe("INVALID_TRACKING");
  });
  it("rejects when within 24h of Stage1 deadline (400 DEADLINE_TOO_CLOSE)", async () => {
    const seller=kp(); const winner=kp(); const server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    // created 9 days + 1 hour ago => ~23h left
    const createdAt = Date.now() - (9*24*3600*1000 + 3600*1000);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data:"{}", tracking_number:null, tracking_kind:null, migrated_at:null, created_at: createdAt });
    const sig=signSecret(`tracking:a1:EE473124829US`, seller.sk);
    const res=await app.request("http://localhost/api/auctions/a1/tracking",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ tracking_number:"EE473124829US", seller_pubkey:seller.pk, seller_sig:sig }) });
    expect(res.status).toBe(400); expect((await res.json() as {error:string}).error).toBe("DEADLINE_TOO_CLOSE");
  });
  it("rejects non-seller (403 NOT_SELLER)", async () => {
    const seller=kp(); const winner=kp(); const attacker=kp(); const server=kp();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example", claimed:true } as unknown as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data:"{}", tracking_number:null, tracking_kind:null, migrated_at:null, created_at: Date.now() });
    const sig=signSecret(`tracking:a1:EE473124829US`, attacker.sk);
    const res=await app.request("http://localhost/api/auctions/a1/tracking",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ tracking_number:"EE473124829US", seller_pubkey:attacker.pk, seller_sig:sig }) });
    expect(res.status).toBe(403);
  });
});
