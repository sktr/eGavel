import Database from "better-sqlite3"
import type { Auction, Bid } from "@egavel/shared"

export interface Db {
  getActiveAuctions: () => Promise<Auction[]>
  getAllAuctions: () => Promise<Auction[]>
  getAuction: (id: string) => Promise<Auction | null>
  saveAuction: (auction: Auction) => Promise<void>
  getVerifiedBids: (auctionId: string) => Promise<Bid[]>
  getAllBids: (auctionId: string) => Promise<Bid[]>
  saveBid: (bid: Bid) => Promise<void>
  /**
   * Atomic save of a pre-registration (status='pending'). Same shape as saveBid
   * but refuses to overwrite an already-`verified` row (downgrade guard), enforced
   * in SQL so a concurrent live bid is never demoted across Worker isolates.
   */
  savePendingBid: (bid: Bid) => Promise<void>
  getAuctionsBySeller: (sellerPubkey: string) => Promise<Auction[]>
  getBidsByBidder: (bidderPubkey: string) => Promise<Bid[]>
  getBid: (id: string) => Promise<Bid | null>
  saveShipping: (auctionId: string, address: string, note: string | null) => Promise<void>
  getShipping: (auctionId: string) => Promise<{ address: string; note: string | null } | null>
  saveFee: (auctionId: string, amount: number, proofs: string) => Promise<void>
  saveChange: (auctionId: string, bidderNpub: string, amount: number, proofs: string) => Promise<void>
  getChange: (auctionId: string) => Promise<{ bidder_npub: string; amount: number; proofs: string } | null>
  tryLockProofs: (bidId: string, auctionId: string, Ys: string[]) => Promise<string[]>
  unlockProofs: (bidId: string, Ys: string[]) => Promise<void>
  /** Atomic state transition ACTIVE/EXTENDED → SETTLED. Returns true if this call performed the transition. */
  settleAuction: (auctionId: string, winnerNpub: string | null, winningAmount: number) => Promise<boolean>
  /** Remove a listing (only valid for auctions with no bids). */
  deleteAuction: (auctionId: string) => Promise<void>
  exec: (sql: string) => Promise<void>
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
      image TEXT,
      images TEXT
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
      FOREIGN KEY (auction_id) REFERENCES auctions(id)
    );

    CREATE TABLE IF NOT EXISTS shipping (
      auction_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
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

    -- One row per proof (Y) locked by a bid. UNIQUE(Y) prevents the same
    -- proofs from backing multiple bids/auctions (double-lock).
    CREATE TABLE IF NOT EXISTS bid_proofs (
      Y TEXT PRIMARY KEY,
      bid_id TEXT NOT NULL,
      auction_id TEXT NOT NULL,
      locked_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids(auction_id);
    CREATE INDEX IF NOT EXISTS idx_bids_auction_amount ON bids(auction_id, max_amount DESC);
  `)

  // Add proof_data column if it doesn't exist (migration for existing DBs)
  try {
    db.exec("ALTER TABLE bids ADD COLUMN proof_data TEXT")
  } catch {
    // column already exists — fine
  }

  // ── Proxy bidding migration (2026-08-12): amount → max_amount + current_amount ──
  // Old DBs have `amount` (locked proofs total == the bidder's max). New DBs create
  // the table with max_amount/current_amount directly, so these ALTERs are no-ops.
  try {
    db.exec("ALTER TABLE bids RENAME COLUMN amount TO max_amount")
  } catch {
    // already migrated or fresh table — fine
  }
  try {
    db.exec("ALTER TABLE bids ADD COLUMN max_amount INTEGER")
  } catch {
    // already exists — fine
  }
  try {
    db.exec("ALTER TABLE bids ADD COLUMN current_amount INTEGER")
  } catch {
    // already exists — fine
  }
  try {
    db.exec(
      "UPDATE bids SET current_amount = max_amount WHERE current_amount IS NULL",
    )
  } catch {
    // fine
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
    "ALTER TABLE auctions ADD COLUMN images TEXT",
  ]) {
    try {
      db.exec(col)
    } catch {
      // column already exists — fine
    }
  }

  // Shipping free-text migration (2026-08-13): rewrite the legacy fixed-choice
  // option values to neutral wording. Naturally idempotent — a re-run finds no
  // rows matching the old values.
  db.exec(
    `UPDATE auctions SET shipping = 'Courier (buyer pays shipping)' WHERE shipping = 'Home delivery';
     UPDATE auctions SET shipping = 'Courier (free shipping)' WHERE shipping = 'Home delivery (shipping included)';
     UPDATE auctions SET shipping = 'In-person handover' WHERE shipping = 'In-person handoff';`,
  )

  const insertAuction = db.prepare(`
    INSERT OR REPLACE INTO auctions
      (id, item, description, start_price, reserve_price, buy_now_price, end_time, seller_pubkey, state, start_time, last_extended_at, winner_npub, winning_amount, mint_url, category, condition, shipping, image, images)
    VALUES
      (@id, @item, @description, @start_price, @reserve_price, @buy_now_price, @end_time, @seller_pubkey, @state, @start_time, @last_extended_at, @winner_npub, @winning_amount, @mint_url, @category, @condition, @shipping, @image, @images)
  `)

  function parseRow(row: Auction): Auction {
    if (typeof row.images === "string") {
      try {
        row.images = JSON.parse(row.images) as string[]
      } catch {
        delete row.images
      }
    }
    if (!Array.isArray(row.images)) {
      if (typeof row.image === "string" && /^(data:|https?:\/\/)/.test(row.image)) {
        row.images = [row.image]
      } else {
        delete row.images
      }
    }
    return row
  }

  return {
    async getActiveAuctions() {
      return (db
        .prepare("SELECT * FROM auctions WHERE state = 'ACTIVE' OR state = 'EXTENDED'")
        .all() as Auction[]).map(parseRow)
    },

    async getAllAuctions() {
      return (db
        .prepare("SELECT * FROM auctions ORDER BY end_time DESC")
        .all() as Auction[]).map(parseRow)
    },

    async getAuction(id: string) {
      const row = db.prepare("SELECT * FROM auctions WHERE id = ?").get(id) as Auction | undefined
      return row ? parseRow(row) : null
    },

    async saveAuction(auction: Auction) {
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
        image: auction.images?.[0] ?? auction.image ?? null,
        images: auction.images ? JSON.stringify(auction.images) : null,
      })
    },

    async getVerifiedBids(auctionId: string) {
      return db
        .prepare(
          "SELECT * FROM bids WHERE auction_id = ? AND status = 'verified' ORDER BY max_amount DESC, received_at ASC",
        )
        .all(auctionId) as Bid[]
    },

    async getAllBids(auctionId: string) {
      return db
        .prepare("SELECT * FROM bids WHERE auction_id = ? ORDER BY max_amount DESC, received_at ASC")
        .all(auctionId) as Bid[]
    },

    async saveBid(bid: Bid) {
      db.prepare(
        `INSERT OR REPLACE INTO bids (id, auction_id, max_amount, current_amount, bidder_npub, Y, received_at, status, proof_data)
         VALUES (@id, @auction_id, @max_amount, @current_amount, @bidder_npub, @Y, @received_at, @status, @proof_data)`,
      ).run({ ...bid, proof_data: bid.proof_data ?? null })
    },

    async savePendingBid(bid: Bid) {
      db.prepare(
        `INSERT INTO bids (id, auction_id, max_amount, current_amount, bidder_npub, Y, received_at, status, proof_data)
         VALUES (@id, @auction_id, @max_amount, @current_amount, @bidder_npub, @Y, @received_at, @status, @proof_data)
         ON CONFLICT(id) DO UPDATE SET
           max_amount = excluded.max_amount,
           current_amount = excluded.current_amount,
           bidder_npub = excluded.bidder_npub,
           Y = excluded.Y,
           received_at = excluded.received_at,
           status = excluded.status,
           proof_data = excluded.proof_data
         WHERE bids.status != 'verified'`,
      ).run({ ...bid, proof_data: bid.proof_data ?? null })
    },

    async getAuctionsBySeller(sellerPubkey: string) {
      return (db
        .prepare("SELECT * FROM auctions WHERE seller_pubkey = ? ORDER BY end_time DESC")
        .all(sellerPubkey) as Auction[]).map(parseRow)
    },

    async getBidsByBidder(bidderPubkey: string) {
      return db
        .prepare("SELECT * FROM bids WHERE bidder_npub = ? ORDER BY received_at DESC")
        .all(bidderPubkey) as Bid[]
    },

    async getBid(id: string) {
      return (db.prepare("SELECT * FROM bids WHERE id = ?").get(id) ?? null) as Bid | null
    },

    async saveShipping(auctionId, address, note) {
      db.prepare(
        `INSERT OR REPLACE INTO shipping (auction_id, address, note, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(auctionId, address, note, Date.now())
    },

    async getShipping(auctionId) {
      return (db
        .prepare("SELECT address, note FROM shipping WHERE auction_id = ?")
        .get(auctionId) ?? null) as { address: string; note: string | null } | null
    },
    async saveFee(auctionId, amount, proofs) {
      db.prepare(
        `INSERT OR REPLACE INTO fees (auction_id, amount, proofs, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(auctionId, amount, proofs, Date.now())
    },

    async saveChange(auctionId, bidderNpub, amount, proofs) {
      db.prepare(
        `INSERT OR REPLACE INTO change_returns (auction_id, bidder_npub, amount, proofs, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(auctionId, bidderNpub, amount, proofs, Date.now())
    },

    async getChange(auctionId) {
      return (db
        .prepare("SELECT bidder_npub, amount, proofs FROM change_returns WHERE auction_id = ?")
        .get(auctionId) ?? null) as {
        bidder_npub: string
        amount: number
        proofs: string
      } | null
    },

    async tryLockProofs(bidId, auctionId, Ys) {
      const insert = db.prepare(
        "INSERT OR IGNORE INTO bid_proofs (Y, bid_id, auction_id, locked_at) VALUES (?, ?, ?, ?)",
      )
      const now = Date.now()
      const acquired: string[] = []
      for (const y of Ys) {
        const res = insert.run(y, bidId, auctionId, now)
        if (res.changes > 0) acquired.push(y)
      }
      return acquired
    },

    async unlockProofs(bidId, Ys) {
      if (Ys.length === 0) return
      const placeholders = Ys.map(() => "?").join(", ")
      db.prepare(`DELETE FROM bid_proofs WHERE bid_id = ? AND Y IN (${placeholders})`).run(bidId, ...Ys)
    },

    async settleAuction(auctionId, winnerNpub, winningAmount) {
      const res = db
        .prepare(
          "UPDATE auctions SET state = 'SETTLED', winner_npub = ?, winning_amount = ? WHERE id = ? AND state IN ('ACTIVE','EXTENDED')",
        )
        .run(winnerNpub, winningAmount, auctionId)
      return res.changes > 0
    },

    async deleteAuction(auctionId) {
      db.prepare("DELETE FROM auctions WHERE id = ?").run(auctionId)
    },

    async exec(sql: string) {
      db.exec(sql)
    },

  }
}
