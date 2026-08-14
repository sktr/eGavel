-- Claim idempotency: track whether the seller has claimed the winning bid.
-- The claim panel hides the claim button once claimed=true, so a page reload
-- after a successful claim no longer offers a second (failing) claim.
ALTER TABLE auctions ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0;
