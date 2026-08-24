import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("initDb repairs legacy two-stage escrow tables", () => {
  const dir = mkdtempSync(join(tmpdir(), "egavel-escrow-repair-"));
  const dbPath = join(dir, "test.db");
  let prevPath: string | undefined;

  afterEach(() => {
    if (prevPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = prevPath;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rebuilds the superseded 8-column table to the v1 shape, preserving rows", async () => {
    prevPath = process.env.DB_PATH;
    process.env.DB_PATH = dbPath;

    // Boot once (creates current schema + auctions table), then simulate a
    // database created by the superseded two-stage design (old migration
    // 0008 as originally shipped).
    const first = initDb();
    await first.saveAuction(auctionFor("a-old"));
    await first.exec(`
      DROP TABLE fulfillment_escrows;
      CREATE TABLE fulfillment_escrows (
        auction_id      TEXT PRIMARY KEY REFERENCES auctions(id),
        stage           INTEGER NOT NULL DEFAULT 1,
        status          TEXT NOT NULL DEFAULT 'active',
        proofs_data     TEXT NOT NULL,
        tracking_number TEXT,
        tracking_kind   TEXT,
        migrated_at     INTEGER,
        created_at      INTEGER NOT NULL
      );
      INSERT INTO fulfillment_escrows (auction_id, proofs_data, created_at)
        VALUES ('a-old', '{"proofs":[],"amount":100}', 123);
    `);

    // Re-open: the shape repair must rebuild to the v1 columns.
    const second = initDb();
    const row = await second.getEscrow("a-old");
    expect(row).not.toBeNull();
    expect(row!.shipped).toBe(0);
    expect(row!.created_at).toBe(123);

    // And the repaired table supports normal v1 writes.
    await second.setShipped("a-old");
    expect((await second.getEscrow("a-old"))?.shipped).toBe(1);
  });

  it("leaves an already-v1-shaped table untouched", async () => {
    prevPath = process.env.DB_PATH;
    process.env.DB_PATH = dbPath;

    const first = initDb();
    await first.saveAuction(auctionFor("a-new"));
    await first.saveEscrow({ auction_id: "a-new", shipped: 1, proofs_data: "{}", created_at: 456 });

    const second = initDb();
    const row = await second.getEscrow("a-new");
    expect(row).not.toBeNull();
    expect(row!.shipped).toBe(1); // flag survives a re-boot
    expect(row!.created_at).toBe(456);
  });
});
