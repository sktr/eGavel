-- Remove the orphaned winner-address shipping table. The address-collection
-- API was removed in 2026-08-15 (npub handoff replaces it); the table only
-- survives on D1 databases that already applied 0000_init.sql. No code
-- references it anymore — dropping it also clears any previously stored
-- shipping addresses.
DROP TABLE IF EXISTS shipping;
