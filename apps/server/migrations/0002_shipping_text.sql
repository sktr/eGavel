-- Rewrite legacy fixed-choice shipping option values to neutral wording
-- (see docs/superpowers/specs/2026-08-13-shipping-method-free-text-design.md).
UPDATE auctions SET shipping = 'Courier (buyer pays shipping)' WHERE shipping = 'Home delivery';
UPDATE auctions SET shipping = 'Courier (free shipping)' WHERE shipping = 'Home delivery (shipping included)';
UPDATE auctions SET shipping = 'In-person handover' WHERE shipping = 'In-person handoff';
