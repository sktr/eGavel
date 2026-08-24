-- 0009: fulfillment_escrows shape repair (v1 redesign, 2026-08-24).
--
-- Migration 0008 was rewritten in place by the v1 simplification instead of
-- being superseded by a new file. A remote D1 that had already applied the
-- ORIGINAL 8-column two-stage version (stage/status/tracking_number/
-- tracking_kind/migrated_at) therefore never received the v1 shape, and every
-- escrow write on the Worker fails with "no such column: shipped". This file
-- rebuilds the table unconditionally to the v1 shape using only columns that
-- exist in BOTH variants (auction_id/proofs_data/created_at); shipped resets
-- to 0 for carried-over rows. On a database already at the v1 shape this is a
-- lossless no-op rebuild.
--
-- Before applying remotely you can inspect the current shape:
--   wrangler d1 execute egavel-db --remote --command "PRAGMA table_info(fulfillment_escrows)"

CREATE TABLE IF NOT EXISTS fulfillment_escrows_repaired (
  auction_id      TEXT PRIMARY KEY REFERENCES auctions(id),
  shipped         INTEGER NOT NULL DEFAULT 0,
  proofs_data     TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

INSERT OR IGNORE INTO fulfillment_escrows_repaired (auction_id, proofs_data, created_at)
  SELECT auction_id, proofs_data, created_at FROM fulfillment_escrows;

DROP TABLE fulfillment_escrows;

ALTER TABLE fulfillment_escrows_repaired RENAME TO fulfillment_escrows;
