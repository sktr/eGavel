import { describe, it, expect, beforeEach } from "vitest";
import { initDb, type Db } from "../src/db/index.js";
import type { EscrowRow } from "../src/db/index.js";
import type { Auction } from "@egavel/shared";

function auctionFor(id: string): Auction {
  return {
    id,
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
  };
}

async function saveEscrowWithAuction(db: Db, row: EscrowRow) {
  // fulfillment_escrows.auction_id REFERENCES auctions(id) — need parent row for FK
  if (!(await db.getAuction(row.auction_id))) {
    await db.saveAuction(auctionFor(row.auction_id));
  }
  await db.saveEscrow(row);
}

function escrowRow(overrides: Partial<EscrowRow> = {}): EscrowRow {
  return {
    auction_id: "a1", stage: 1, status: "active",
    proofs_data: JSON.stringify({ proofs: [{ secret: "s" }], amount: 100 }),
    tracking_number: null, tracking_kind: null, migrated_at: null,
    created_at: Date.now(), ...overrides,
  };
}

describe("fulfillment_escrows Db", () => {
  let db: Db;
  beforeEach(() => { db = initDb(); });

  it("round-trips saveEscrow/getEscrow", async () => {
    await saveEscrowWithAuction(db, escrowRow());
    const got = await db.getEscrow("a1");
    expect(got?.auction_id).toBe("a1");
    expect(got?.stage).toBe(1);
    expect(got?.status).toBe("active");
  });
  it("returns null for missing escrow", async () => {
    expect(await db.getEscrow("nope")).toBeNull();
  });
  it("updateEscrowStage changes stage/proofs/status/migratedAt", async () => {
    await saveEscrowWithAuction(db, escrowRow());
    await db.updateEscrowStage("a1", 2, JSON.stringify({ proofs: [] }), "migrating", Date.now());
    const got = await db.getEscrow("a1");
    expect(got?.stage).toBe(2);
    expect(got?.status).toBe("migrating");
    expect(got?.migrated_at).not.toBeNull();
  });
  it("setEscrowStatus updates status only", async () => {
    await saveEscrowWithAuction(db, escrowRow());
    await db.setEscrowStatus("a1", "confirmed");
    expect((await db.getEscrow("a1"))?.status).toBe("confirmed");
  });
  it("setEscrowTracking stores number and kind", async () => {
    await saveEscrowWithAuction(db, escrowRow());
    await db.setEscrowTracking("a1", "EE473124829US", "s10");
    const got = await db.getEscrow("a1");
    expect(got?.tracking_number).toBe("EE473124829US");
    expect(got?.tracking_kind).toBe("s10");
  });
  it("covers all terminal statuses (enum completeness)", async () => {
    const statuses = ["active","migrating","confirmed","refunded_winner","swept_seller","split_resolved"];
    for (const s of statuses) {
      await saveEscrowWithAuction(db, escrowRow({ auction_id: `a-${s}`, status: s }));
      expect((await db.getEscrow(`a-${s}`))?.status).toBe(s);
    }
  });
});
