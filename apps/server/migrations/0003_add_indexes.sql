-- Dashboard / seller queries: add indexes on the per-user lookup columns.
-- getBidsByBidder (bidder_npub) and getAuctionsBySeller (seller_pubkey) were
-- doing full scans. Mirrors the CREATE INDEX statements in initDb (better-sqlite3).
CREATE INDEX IF NOT EXISTS idx_bids_bidder_npub ON bids(bidder_npub);
CREATE INDEX IF NOT EXISTS idx_auctions_seller_pubkey ON auctions(seller_pubkey);
