-- Monsters, map flags and the respawn point.

-- Map field 12, items 1, 2, 3 and 5:
-- the fighting flag ("O" = no fighting), the faction spawn swap (W/M/A), the indoors flag, the PvP flag
-- ("O" = no PvP). Edited in the world editor.
ALTER TABLE maps ADD COLUMN can_fight TEXT NOT NULL DEFAULT 'X';
ALTER TABLE maps ADD COLUMN fct_spwn TEXT NOT NULL DEFAULT 'X';
ALTER TABLE maps ADD COLUMN is_indoors TEXT NOT NULL DEFAULT 'X';
ALTER TABLE maps ADD COLUMN can_pvp TEXT NOT NULL DEFAULT 'X';

-- The seed map keeps the flags of the archived x1000y992, "X:X:X:None:X:NoTex:0:255:255:255": the
-- defaults.

-- Four roster slots per map and the one live monster each may hold (1.6's fifth slot never
-- spawned, so a roster has four). `species` is the roster entry; `live_name` is the monster in the
-- slot now (a faction swap can differ). `last_hp` is the HP the slot's last occupant had when it
-- died, which a species with no HP entry inherits.
CREATE TABLE map_slots (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  species TEXT,
  live_name TEXT,
  hp INTEGER NOT NULL DEFAULT 0,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  facing TEXT NOT NULL DEFAULT 'S' CHECK (facing IN ('N', 'S', 'E', 'W')),
  last_hp INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (map_id, slot)
);

-- The seed roster has a Slime in slot 1 and no live monsters.
INSERT INTO map_slots (map_id, slot, species, updated_at) VALUES
  ('01a1a613-69ff-72dc-8025-af4ca595e963', 1, 'Slime', '2026-11-05T00:00:00.000Z'),
  ('01a1a613-69ff-72dc-8025-af4ca595e963', 2, NULL, '2026-11-05T00:00:00.000Z'),
  ('01a1a613-69ff-72dc-8025-af4ca595e963', 3, NULL, '2026-11-05T00:00:00.000Z'),
  ('01a1a613-69ff-72dc-8025-af4ca595e963', 4, NULL, '2026-11-05T00:00:00.000Z');

-- The death-respawn point the server wrote when the character last drew an O-O-O map (1.6's
-- death-map write). NULL = the operator's respawnPoint setting (seeded from 1.6's death-map file).
ALTER TABLE characters ADD COLUMN respawn_map_id TEXT REFERENCES maps(id);
ALTER TABLE characters ADD COLUMN respawn_x INTEGER;
ALTER TABLE characters ADD COLUMN respawn_y INTEGER;
