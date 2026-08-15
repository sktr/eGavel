-- Initial Cashu Auction schema (Cloudflare D1).
-- SQLite dialect — identical to the better-sqlite3 initDb() schema.

CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  description TEXT NOT NULL,
  start_price INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  seller_pubkey TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  start_time INTEGER NOT NULL,
  last_extended_at INTEGER,
  winner_npub TEXT,
  winning_amount INTEGER,
  mint_url TEXT NOT NULL DEFAULT '',
  reserve_price INTEGER,
  buy_now_price INTEGER,
  category TEXT,
  condition TEXT,
  shipping TEXT,
  image TEXT
);

CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL,
  max_amount INTEGER NOT NULL,
  current_amount INTEGER NOT NULL,
  bidder_npub TEXT NOT NULL,
  Y TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified',
  proof_data TEXT,
  FOREIGN KEY (auction_id) REFERENCES auctions(id)
);

CREATE TABLE IF NOT EXISTS fees (
  auction_id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  proofs TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (auction_id) REFERENCES auctions(id)
);

CREATE TABLE IF NOT EXISTS change_returns (
  auction_id TEXT PRIMARY KEY,
  bidder_npub TEXT NOT NULL,
  amount INTEGER NOT NULL,
  proofs TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (auction_id) REFERENCES auctions(id)
);

CREATE TABLE IF NOT EXISTS bid_proofs (
  Y TEXT PRIMARY KEY,
  bid_id TEXT NOT NULL,
  auction_id TEXT NOT NULL,
  locked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids(auction_id);
CREATE INDEX IF NOT EXISTS idx_bids_auction_amount ON bids(auction_id, max_amount DESC);
