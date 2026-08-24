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
  if (!(await db.getAuction(row.auction_id))) {
    await db.saveAuction(auctionFor(row.auction_id));
  }
  await db.saveEscrow(row);
}

function escrowRow(overrides: Partial<EscrowRow> = {}): EscrowRow {
  return {
    auction_id: "a1",
    shipped: 0,
    proofs_data: JSON.stringify({ proofs: [{ secret: "s" }], amount: 100 }),
    created_at: Date.now(),
    ...overrides,
  };
}

describe("fulfillment_escrows Db", () => {
  let db: Db;
  beforeEach(() => { db = initDb(); });

  it("round-trips saveEscrow/getEscrow", async () => {
    await saveEscrowWithAuction(db, escrowRow());
    const got = await db.getEscrow("a1");
    expect(got?.auction_id).toBe("a1");
    expect(got?.shipped).toBe(0);
  });
  it("returns null for missing escrow", async () => {
    expect(await db.getEscrow("nope")).toBeNull();
  });
  it("setShipped updates shipped flag", async () => {
    await saveEscrowWithAuction(db, escrowRow());
    await db.setShipped("a1");
    expect((await db.getEscrow("a1"))?.shipped).toBe(1);
  });
  it("deleteEscrow removes row", async () => {
    await saveEscrowWithAuction(db, escrowRow());
    await db.deleteEscrow("a1");
    expect(await db.getEscrow("a1")).toBeNull();
  });
});
