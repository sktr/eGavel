import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";
import { initDb } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret } from "../src/lib/schnorr.js";
import type { Auction } from "@egavel/shared";

function keypair() { const sk=bytesToHex(schnorr.utils.randomSecretKey()); return { sk, pk: bytesToHex(schnorr.getPublicKey(hexToBytes(sk))) }; }

describe("GET /auctions/:id/escrow", () => {
  it("returns 404 when no escrow row", async () => {
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: keypair().sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:"02aa", state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:"03bb", winning_amount:100, mint_url:"https://mint.example" } as Auction);
    const res=await app.request("http://localhost/api/auctions/a1/escrow?party_pubkey=02aa&party_sig=sig");
    expect(res.status).toBe(404);
  });
  it("seller can read own escrow (Schnorr over escrow-view:<id>)", async () => {
    const seller=keypair(); const winner=keypair(); const server=keypair();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example" } as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data: JSON.stringify({ proofs:[] }), tracking_number:null, tracking_kind:null, migrated_at:null, created_at: Date.now() });
    const sig=signSecret(`escrow-view:a1`, seller.sk);
    const res=await app.request(`http://localhost/api/auctions/a1/escrow?party_pubkey=${seller.pk}&party_sig=${sig}`);
    expect(res.status).toBe(200);
    const body=await res.json() as { auction_id:string; proofs_data:string };
    expect(body.auction_id).toBe("a1"); expect(typeof body.proofs_data).toBe("string");
  });
  it("rejects third party", async () => {
    const seller=keypair(); const winner=keypair(); const attacker=keypair(); const server=keypair();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:winner.pk, winning_amount:100, mint_url:"https://mint.example" } as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data:"{}", tracking_number:null, tracking_kind:null, migrated_at:null, created_at: Date.now() });
    const sig=signSecret(`escrow-view:a1`, attacker.sk);
    const res=await app.request(`http://localhost/api/auctions/a1/escrow?party_pubkey=${attacker.pk}&party_sig=${sig}`);
    expect(res.status).toBe(403);
  });
  it("rejects invalid signature (401)", async () => {
    const seller=keypair(); const server=keypair();
    const db=initDb(); const app=new Hono(); app.route("/api", createAuctionRoutes(db, { serverKey: server.sk }));
    await db.saveAuction({ id:"a1", item:"t", description:"d", start_price:100, reserve_price:null, buy_now_price:null, end_time:Date.now()+3600_000, seller_pubkey:seller.pk, state:"SETTLED", start_time:Date.now(), last_extended_at:null, winner_npub:"03bb", winning_amount:100, mint_url:"https://mint.example" } as Auction);
    await db.saveEscrow({ auction_id:"a1", stage:1, status:"active", proofs_data:"{}", tracking_number:null, tracking_kind:null, migrated_at:null, created_at: Date.now() });
    const res=await app.request(`http://localhost/api/auctions/a1/escrow?party_pubkey=${seller.pk}&party_sig=badsig`);
    expect(res.status).toBe(401);
  });
});
