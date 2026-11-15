-- Inventory, equipment and ground items. Gold stays in characters.gold and the bag in `inventory`.

-- The six equipment slots; an empty slot (`NOTHING`) has no row.
CREATE TABLE equipment (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('Head', 'Body', 'LeftHand', 'RightHand', 'Feet', 'Ring')),
  item TEXT NOT NULL,
  PRIMARY KEY (character_id, slot)
);

-- Ground items: the original's `Name:px-py` entries of its per-map item file, by tile (SSO gives
-- ground items and containers server ids, and has no per-map ground-item slot limit). `kind` is
-- loot (monster drops, which decay), drop (player drops, gives and death drops) or admin (`/drop`).
-- `expires_at` is set for loot only. UUIDv7 ids sort by creation, which is the order of the
-- original's lowest-empty-slot writes.
CREATE TABLE ground_items (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x INTEGER NOT NULL CHECK (x BETWEEN 1 AND 17),
  y INTEGER NOT NULL CHECK (y BETWEEN 1 AND 12),
  item TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('loot', 'drop', 'admin')),
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ground_items_map ON ground_items(map_id);
