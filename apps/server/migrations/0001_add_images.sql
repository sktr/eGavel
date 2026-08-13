-- Add multi-image support: JSON array of data URLs (max 4 per listing).
ALTER TABLE auctions ADD COLUMN images TEXT;
