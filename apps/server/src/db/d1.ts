import type { D1Database } from "@cloudflare/workers-types"
import type { Auction, Bid } from "@egavel/shared"
import type { Db, EscrowRow } from "./index.js"

/**
 * Db implementation over the Cloudflare D1 binding.
 *
 * The SQL is identical to the better-sqlite3 implementation (D1 is SQLite);
 * the only difference is the asynchronous API. `changes` comes from the D1
 * run() meta.
 */
export function createD1Db(d1: D1Database): Db {
  async function changes(statement: D1PreparedStatementLike): Promise<number> {
    const res = await statement.run()
    return (res as unknown as { meta?: { changes?: number }; changes?: number }).meta?.changes ??
      (res as unknown as { changes?: number }).changes ??
      0
  }

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
    if (row.claimed !== undefined) row.claimed = Boolean(row.claimed)
    return row
  }

  return {
    async getActiveAuctions() {
      const { results } = await d1
        .prepare("SELECT * FROM auctions WHERE state = 'ACTIVE' OR state = 'EXTENDED'")
        .all<Auction>()
      return results.map(parseRow)
    },

    async getAllAuctions() {
      const { results } = await d1
        .prepare("SELECT * FROM auctions ORDER BY end_time DESC")
        .all<Auction>()
      return results.map(parseRow)
    },

    async getAuction(id: string) {
      const row = await d1.prepare("SELECT * FROM auctions WHERE id = ?").bind(id).first<Auction>()
      return row ? parseRow(row) : null
    },

    async saveAuction(auction: Auction) {
      await d1
        .prepare(
          `INSERT OR REPLACE INTO auctions
            (id, item, description, start_price, reserve_price, buy_now_price, end_time, seller_pubkey, state, start_time, last_extended_at, winner_npub, winning_amount, mint_url, category, condition, shipping, image, images)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          auction.id,
          auction.item,
          auction.description,
          auction.start_price,
          auction.reserve_price,
          auction.buy_now_price,
          auction.end_time,
          auction.seller_pubkey,
          auction.state,
          auction.start_time,
          auction.last_extended_at,
          auction.winner_npub,
          auction.winning_amount,
          auction.mint_url,
          auction.category ?? null,
          auction.condition ?? null,
          auction.shipping ?? null,
          auction.images?.[0] ?? auction.image ?? null,
          auction.images ? JSON.stringify(auction.images) : null,
        )
        .run()
    },

    async getVerifiedBids(auctionId: string) {
      const { results } = await d1
        .prepare(
          "SELECT * FROM bids WHERE auction_id = ? AND status = 'verified' ORDER BY max_amount DESC, received_at ASC",
        )
        .bind(auctionId)
        .all<Bid>()
      return results
    },

    async getAllBids(auctionId: string) {
      const { results } = await d1
        .prepare("SELECT * FROM bids WHERE auction_id = ? ORDER BY max_amount DESC, received_at ASC")
        .bind(auctionId)
        .all<Bid>()
      return results
    },

    async saveBid(bid: Bid) {
      await d1
        .prepare(
          `INSERT OR REPLACE INTO bids
            (id, auction_id, max_amount, current_amount, bidder_npub, Y, received_at, status, proof_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          bid.id,
          bid.auction_id,
          bid.max_amount,
          bid.current_amount,
          bid.bidder_npub,
          bid.Y,
          bid.received_at,
          bid.status,
          bid.proof_data,
        )
        .run()
    },

    async savePendingBid(bid: Bid) {
      await d1
        .prepare(
          `INSERT INTO bids
            (id, auction_id, max_amount, current_amount, bidder_npub, Y, received_at, status, proof_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             max_amount = excluded.max_amount,
             current_amount = excluded.current_amount,
             bidder_npub = excluded.bidder_npub,
             Y = excluded.Y,
             received_at = excluded.received_at,
             status = excluded.status,
             proof_data = excluded.proof_data
           WHERE bids.status != 'verified'`,
        )
        .bind(
          bid.id,
          bid.auction_id,
          bid.max_amount,
          bid.current_amount,
          bid.bidder_npub,
          bid.Y,
          bid.received_at,
          bid.status,
          bid.proof_data,
        )
        .run()
    },

    async getAuctionsBySeller(sellerPubkey: string) {
      const { results } = await d1
        .prepare("SELECT * FROM auctions WHERE seller_pubkey = ? ORDER BY end_time DESC")
        .bind(sellerPubkey)
        .all<Auction>()
      return results.map(parseRow)
    },

    async getBidsByBidder(bidderPubkey: string) {
      const { results } = await d1
        .prepare("SELECT * FROM bids WHERE bidder_npub = ? ORDER BY received_at DESC")
        .bind(bidderPubkey)
        .all<Bid>()
      return results
    },

    async getBid(id: string) {
      return d1.prepare("SELECT * FROM bids WHERE id = ?").bind(id).first<Bid>()
    },

    async saveFee(auctionId, amount, proofs) {
      await d1
        .prepare(
          "INSERT OR REPLACE INTO fees (auction_id, amount, proofs, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(auctionId, amount, proofs, Date.now())
        .run()
    },

    async saveChange(auctionId, bidderNpub, amount, proofs) {
      await d1
        .prepare(
          "INSERT OR REPLACE INTO change_returns (auction_id, bidder_npub, amount, proofs, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(auctionId, bidderNpub, amount, proofs, Date.now())
        .run()
    },

    async getChange(auctionId) {
      return d1
        .prepare("SELECT bidder_npub, amount, proofs FROM change_returns WHERE auction_id = ?")
        .bind(auctionId)
        .first<{ bidder_npub: string; amount: number; proofs: string }>()
    },

    async markClaimed(auctionId) {
      await d1.prepare("UPDATE auctions SET claimed = 1 WHERE id = ?").bind(auctionId).run()
    },

    async tryLockProofs(bidId, auctionId, Ys) {
      const acquired: string[] = []
      for (const y of Ys) {
        const n = await changes(
          d1
            .prepare(
              "INSERT OR IGNORE INTO bid_proofs (Y, bid_id, auction_id, locked_at) VALUES (?, ?, ?, ?)",
            )
            .bind(y, bidId, auctionId, Date.now()),
        )
        if (n > 0) acquired.push(y)
      }
      return acquired
    },

    async unlockProofs(bidId, Ys) {
      if (Ys.length === 0) return
      const placeholders = Ys.map(() => "?").join(", ")
      await d1.prepare(`DELETE FROM bid_proofs WHERE bid_id = ? AND Y IN (${placeholders})`).bind(bidId, ...Ys).run()
    },

    async settleAuction(auctionId, winnerNpub, winningAmount) {
      const n = await changes(
        d1
          .prepare(
            "UPDATE auctions SET state = 'SETTLED', winner_npub = ?, winning_amount = ? WHERE id = ? AND state IN ('ACTIVE','EXTENDED')",
          )
          .bind(winnerNpub, winningAmount, auctionId),
      )
      return n > 0
    },

    async deleteAuction(auctionId) {
      await d1.prepare("DELETE FROM auctions WHERE id = ?").bind(auctionId).run()
    },

    async saveNostrLink(tradingPubkey, nostrPubkey) {
      const existing = await d1
        .prepare("SELECT nostr_pubkey FROM nostr_links WHERE trading_pubkey = ?")
        .bind(tradingPubkey)
        .first<{ nostr_pubkey: string }>()
      if (existing && existing.nostr_pubkey !== nostrPubkey) return false
      await d1
        .prepare(
          "INSERT OR REPLACE INTO nostr_links (trading_pubkey, nostr_pubkey, created_at) VALUES (?, ?, ?)",
        )
        .bind(tradingPubkey, nostrPubkey, Date.now())
        .run()
      return true
    },

    async getNostrLink(tradingPubkey) {
      return d1
        .prepare("SELECT nostr_pubkey FROM nostr_links WHERE trading_pubkey = ?")
        .bind(tradingPubkey)
        .first<{ nostr_pubkey: string }>()
    },

    async getAllNostrLinks() {
      const { results } = await d1
        .prepare("SELECT trading_pubkey, nostr_pubkey FROM nostr_links")
        .all<{ trading_pubkey: string; nostr_pubkey: string }>()
      return results
    },

    async deleteNostrLink(tradingPubkey) {
      await d1.prepare("DELETE FROM nostr_links WHERE trading_pubkey = ?").bind(tradingPubkey).run()
    },

    async savePendingReceive(receiverPubkey, mintUrl, proofs, amount) {
      const incoming = JSON.parse(proofs) as Array<{ secret: string }>
      const { results } = await d1
        .prepare("SELECT proofs FROM pending_receives WHERE receiver_pubkey = ? AND mint_url = ?")
        .bind(receiverPubkey, mintUrl)
        .all<{ proofs: string }>()
      const seen = new Set<string>()
      for (const row of results) {
        for (const p of JSON.parse(row.proofs) as Array<{ secret: string }>) seen.add(p.secret)
      }
      const fresh = incoming.filter((p) => !seen.has(p.secret))
      if (fresh.length === 0) return null
      const res = await d1
        .prepare(
          "INSERT INTO pending_receives (receiver_pubkey, mint_url, proofs, amount, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(receiverPubkey, mintUrl, JSON.stringify(fresh), amount, Date.now())
        .run()
      return Number((res as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? 0) || null
    },

    async getPendingReceives(receiverPubkey) {
      // Read-only: rows stay until the client acks them.
      const { results } = await d1
        .prepare("SELECT rowid AS rid, mint_url, proofs, amount FROM pending_receives WHERE receiver_pubkey = ? ORDER BY created_at")
        .bind(receiverPubkey)
        .all<{ rid: number; mint_url: string; proofs: string; amount: number }>()
      return results
    },
    async ackPendingReceives(receiverPubkey, rowids) {
      if (rowids.length === 0) return 0
      const placeholders = rowids.map(() => "?").join(",")
      const res = await d1
        .prepare(
          `DELETE FROM pending_receives WHERE receiver_pubkey = ? AND rowid IN (${placeholders})`,
        )
        .bind(receiverPubkey, ...rowids)
        .run()
      return (res as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0
    },

    async saveEscrow(row: EscrowRow) {
      await d1
        .prepare(
          `INSERT OR REPLACE INTO fulfillment_escrows
            (auction_id, shipped, proofs_data, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(row.auction_id, row.shipped, row.proofs_data, row.created_at)
        .run()
    },
    async getEscrow(auctionId: string) {
      return d1
        .prepare("SELECT * FROM fulfillment_escrows WHERE auction_id = ?")
        .bind(auctionId)
        .first<EscrowRow>()
    },
    async setShipped(auctionId: string) {
      await d1
        .prepare("UPDATE fulfillment_escrows SET shipped = 1 WHERE auction_id = ?")
        .bind(auctionId)
        .run()
    },
    async deleteEscrow(auctionId: string) {
      await d1
        .prepare("DELETE FROM fulfillment_escrows WHERE auction_id = ?")
        .bind(auctionId)
        .run()
    },

    async exec(sql: string) {
      await d1.exec(sql)
    },
  }
}

// Minimal structural type so the code doesn't depend on the full
// @cloudflare/workers-types surface beyond what we use.
interface D1PreparedStatementLike {
  run(): Promise<unknown>
}
