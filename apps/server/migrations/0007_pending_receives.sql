-- NUT-18 incoming payments: a payer POSTs proofs here; the receiver later
-- collects them into their wallet. Multiple payments to the same receiver
-- are appended (proofs are deduped by secret on insert).
CREATE TABLE IF NOT EXISTS pending_receives (
  receiver_pubkey TEXT NOT NULL,
  mint_url TEXT NOT NULL,
  proofs TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_receives_receiver ON pending_receives(receiver_pubkey);
