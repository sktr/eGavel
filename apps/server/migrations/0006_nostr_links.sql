-- Link trading pubkeys to nostr pubkeys (used to map auction activity onto
-- nostr identities). One trading pubkey maps to at most one nostr pubkey.
CREATE TABLE nostr_links (
  trading_pubkey TEXT PRIMARY KEY,
  nostr_pubkey TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
