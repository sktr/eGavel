CREATE TABLE IF NOT EXISTS fulfillment_escrows (
  auction_id      TEXT PRIMARY KEY REFERENCES auctions(id),
  shipped         INTEGER NOT NULL DEFAULT 0,
  proofs_data     TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
