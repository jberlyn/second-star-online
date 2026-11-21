-- migrate: foreign_keys off
-- Boats and Battleships (issue #2): `characters.vehicle` may now hold 'Boat' or 'Battleship' as
-- well as 'Airship'. SQLite cannot change a CHECK in place, so the table is rebuilt with the same
-- columns, rows, index and foreign keys.
CREATE TABLE characters_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The original server refused a name whose file existed; Windows file names ignore case.
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sex INTEGER NOT NULL CHECK (sex IN (1, 2)),
  head INTEGER NOT NULL,
  class_code INTEGER NOT NULL,
  level INTEGER NOT NULL,
  hp INTEGER NOT NULL,
  hp_max INTEGER NOT NULL,
  sp INTEGER NOT NULL,
  sp_max INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  exp_needed INTEGER NOT NULL,
  str INTEGER NOT NULL,
  sta INTEGER NOT NULL,
  agi INTEGER NOT NULL,
  dex INTEGER NOT NULL,
  int INTEGER NOT NULL,
  wis INTEGER NOT NULL,
  spd INTEGER NOT NULL,
  aim INTEGER NOT NULL,
  gold INTEGER NOT NULL,
  profile TEXT NOT NULL,
  hunger INTEGER NOT NULL,
  break_count INTEGER NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  facing TEXT NOT NULL CHECK (facing IN ('N', 'S', 'E', 'W')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  respawn_map_id TEXT REFERENCES maps(id),
  respawn_x INTEGER,
  respawn_y INTEGER,
  faction INTEGER NOT NULL DEFAULT 0 CHECK (faction BETWEEN 0 AND 3),
  faction_count INTEGER NOT NULL DEFAULT 0 CHECK (faction_count >= 0),
  wanted INTEGER NOT NULL DEFAULT 0 CHECK (wanted IN (0, 1)),
  guild TEXT NOT NULL DEFAULT '',
  vehicle TEXT CHECK (vehicle IN ('Airship', 'Boat', 'Battleship')),
  hull INTEGER CHECK (hull IS NULL OR hull >= 0)
);
INSERT INTO characters_new (id, account_id, name, sex, head, class_code, level, hp, hp_max, sp,
  sp_max, exp, exp_needed, str, sta, agi, dex, int, wis, spd, aim, gold, profile, hunger,
  break_count, map_id, x, y, facing, created_at, updated_at, respawn_map_id, respawn_x, respawn_y,
  faction, faction_count, wanted, guild, vehicle, hull)
SELECT id, account_id, name, sex, head, class_code, level, hp, hp_max, sp,
  sp_max, exp, exp_needed, str, sta, agi, dex, int, wis, spd, aim, gold, profile, hunger,
  break_count, map_id, x, y, facing, created_at, updated_at, respawn_map_id, respawn_x, respawn_y,
  faction, faction_count, wanted, guild, vehicle, hull
FROM characters;
DROP TABLE characters;
ALTER TABLE characters_new RENAME TO characters;
CREATE INDEX characters_account ON characters(account_id);
