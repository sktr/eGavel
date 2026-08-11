import Database from "better-sqlite3"
import type { Auction, Bid } from "@cashu-auction/shared"

export interface Db {
  getActiveAuctions: () => Auction[]
  getAllAuctions: () => Auction[]
  getAuction: (id: string) => Auction | null
  saveAuction: (auction: Auction) => void
  getVerifiedBids: (auctionId: string) => Bid[]
  saveBid: (bid: Bid) => void
  getAuctionsBySeller: (sellerPubkey: string) => Auction[]
  getBidsByBidder: (bidderPubkey: string) => Bid[]
  getBid: (id: string) => Bid | null
  saveShipping: (auctionId: string, address: string, note: string | null) => void
  getShipping: (auctionId: string) => { address: string; note: string | null } | null
}

export function initDb(): Db {
  const path = process.env.DB_PATH ?? "data/auction.db"
  const db = new Database(path)

  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  db.exec(`
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
      amount INTEGER NOT NULL,
      bidder_npub TEXT NOT NULL,
      Y TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'verified',
      FOREIGN KEY (auction_id) REFERENCES auctions(id)
    );

    CREATE TABLE IF NOT EXISTS shipping (
      auction_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (auction_id) REFERENCES auctions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids(auction_id);
    CREATE INDEX IF NOT EXISTS idx_bids_auction_amount ON bids(auction_id, amount DESC);
  `)

  // Add proof_data column if it doesn't exist (migration for existing DBs)
  try {
    db.exec("ALTER TABLE bids ADD COLUMN proof_data TEXT")
  } catch {
    // column already exists — fine
  }

  // Add auction columns if they don't exist (idempotent migrations for existing DBs)
  for (const col of [
    "ALTER TABLE auctions ADD COLUMN mint_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE auctions ADD COLUMN reserve_price INTEGER",
    "ALTER TABLE auctions ADD COLUMN buy_now_price INTEGER",
    "ALTER TABLE auctions ADD COLUMN category TEXT",
    "ALTER TABLE auctions ADD COLUMN condition TEXT",
    "ALTER TABLE auctions ADD COLUMN shipping TEXT",
    "ALTER TABLE auctions ADD COLUMN image TEXT",
  ]) {
    try {
      db.exec(col)
    } catch {
      // column already exists — fine
    }
  }

  const insertAuction = db.prepare(`
    INSERT OR REPLACE INTO auctions
      (id, item, description, start_price, reserve_price, buy_now_price, end_time, seller_pubkey, state, start_time, last_extended_at, winner_npub, winning_amount, mint_url, category, condition, shipping, image)
    VALUES
      (@id, @item, @description, @start_price, @reserve_price, @buy_now_price, @end_time, @seller_pubkey, @state, @start_time, @last_extended_at, @winner_npub, @winning_amount, @mint_url, @category, @condition, @shipping, @image)
  `)

  return {
    getActiveAuctions() {
      return db
        .prepare(
          "SELECT * FROM auctions WHERE state = 'ACTIVE' OR state = 'EXTENDED'",
        )
        .all() as Auction[]
    },

    getAllAuctions() {
      return db
        .prepare("SELECT * FROM auctions ORDER BY end_time DESC")
        .all() as Auction[]
    },

    getAuction(id: string) {
      return (db.prepare("SELECT * FROM auctions WHERE id = ?").get(id) ??
        null) as Auction | null
    },

    saveAuction(auction: Auction) {
      insertAuction.run({
        ...auction,
        last_extended_at: auction.last_extended_at ?? null,
        winner_npub: auction.winner_npub ?? null,
        winning_amount: auction.winning_amount ?? null,
        reserve_price: auction.reserve_price ?? null,
        buy_now_price: auction.buy_now_price ?? null,
        category: auction.category ?? null,
        condition: auction.condition ?? null,
        shipping: auction.shipping ?? null,
        image: auction.image ?? null,
      })
    },

    getVerifiedBids(auctionId: string) {
      return db
        .prepare(
          "SELECT * FROM bids WHERE auction_id = ? AND status = 'verified' ORDER BY amount DESC, received_at ASC",
        )
        .all(auctionId) as Bid[]
    },

    saveBid(bid: Bid) {
      db.prepare(
        `INSERT OR REPLACE INTO bids (id, auction_id, amount, bidder_npub, Y, received_at, status, proof_data)
         VALUES (@id, @auction_id, @amount, @bidder_npub, @Y, @received_at, @status, @proof_data)`,
      ).run({ ...bid, proof_data: bid.proof_data ?? null })
    },

    getAuctionsBySeller(sellerPubkey: string) {
      return db
        .prepare("SELECT * FROM auctions WHERE seller_pubkey = ? ORDER BY end_time DESC")
        .all(sellerPubkey) as Auction[]
    },

    getBidsByBidder(bidderPubkey: string) {
      return db
        .prepare("SELECT * FROM bids WHERE bidder_npub = ? ORDER BY received_at DESC")
        .all(bidderPubkey) as Bid[]
    },

    getBid(id: string) {
      return (db.prepare("SELECT * FROM bids WHERE id = ?").get(id) ?? null) as Bid | null
    },

    saveShipping(auctionId, address, note) {
      db.prepare(
        `INSERT OR REPLACE INTO shipping (auction_id, address, note, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(auctionId, address, note, Date.now())
    },

    getShipping(auctionId) {
      return (db
        .prepare("SELECT address, note FROM shipping WHERE auction_id = ?")
        .get(auctionId) ?? null) as { address: string; note: string | null } | null
    },
  }
}
