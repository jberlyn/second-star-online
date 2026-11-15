-- Player shops. A Small Shop's build makes a shopkeeper whose NPC file is an `npc_files` row and
-- whose till and stock are its `npc_shops` ledger. 1.6 tested ownership as `OWN|<name>` contained
-- in the file; SSO keeps the owner's id here and validates it. Decay deletes the row, the file and
-- the ledger with the interior.
CREATE TABLE player_shops (
  npc TEXT PRIMARY KEY COLLATE NOCASE,
  owner_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  interior TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX player_shops_by_interior ON player_shops (interior);
