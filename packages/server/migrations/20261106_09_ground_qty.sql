-- An immortal's `/drop <n> <item>` pile (SSO's own addition). Every other ground item holds one
-- (`qty` 1), as in 1.6, where only gold and crystal piles carried a count in their name.
ALTER TABLE ground_items ADD COLUMN qty INTEGER NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 9999);
