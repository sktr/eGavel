CREATE TABLE IF NOT EXISTS fulfillment_escrows (
  auction_id      TEXT PRIMARY KEY REFERENCES auctions(id),
  stage           INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  proofs_data     TEXT NOT NULL,
  tracking_number TEXT,
  tracking_kind   TEXT,
  migrated_at     INTEGER,
  created_at      INTEGER NOT NULL
);
