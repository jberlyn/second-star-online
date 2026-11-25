-- migrate: foreign_keys off
-- Vehicles are content rows (issue #44): `houses.vehicles`, each with its own rider body and full
-- hull, so a world may have vehicles of its own.
--
-- `characters.vehicle` held only 1.6's three names; it now holds any vehicle row's name. SQLite
-- cannot change a CHECK in place, so the table is rebuilt with the same columns, rows, index and
-- foreign keys.
CREATE TABLE characters_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The original server refused a name whose file existed; Windows file names ignore case.
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sex INTEGER NOT NULL CHECK (sex >= 1),
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
  dex INTEGER NOT NULL,
  int INTEGER NOT NULL,
  wis INTEGER NOT NULL,
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
  faction_count INTEGER NOT NULL DEFAULT 0 CHECK (faction_count >= 0),
  wanted INTEGER NOT NULL DEFAULT 0 CHECK (wanted IN (0, 1)),
  guild TEXT NOT NULL DEFAULT '',
  vehicle TEXT CHECK (vehicle IS NULL OR length(vehicle) BETWEEN 1 AND 80),
  hull INTEGER CHECK (hull IS NULL OR hull >= 0),
  faction TEXT
);
INSERT INTO characters_new (id, account_id, name, sex, head, class_code, level, hp, hp_max, sp,
  sp_max, exp, exp_needed, str, sta, dex, int, wis, gold, profile, hunger, break_count, map_id, x,
  y, facing, created_at, updated_at, respawn_map_id, respawn_x, respawn_y, faction_count, wanted,
  guild, vehicle, hull, faction)
SELECT id, account_id, name, sex, head, class_code, level, hp, hp_max, sp,
  sp_max, exp, exp_needed, str, sta, dex, int, wis, gold, profile, hunger, break_count, map_id, x,
  y, facing, created_at, updated_at, respawn_map_id, respawn_x, respawn_y, faction_count, wanted,
  guild, vehicle, hull, faction
FROM characters;
DROP TABLE characters;
ALTER TABLE characters_new RENAME TO characters;
CREATE INDEX characters_account ON characters(account_id);

-- A removal waiting in the draft may be a vehicle's (issue #28's cleanup).
CREATE TABLE content_draft_actions_new (
  kind TEXT NOT NULL CHECK (kind IN ('item', 'monster', 'vehicle')),
  entry_key TEXT NOT NULL,
  action TEXT NOT NULL,
  author_account_id TEXT NOT NULL,
  author TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, entry_key)
);
INSERT INTO content_draft_actions_new (kind, entry_key, action, author_account_id, author, updated_at)
  SELECT kind, entry_key, action, author_account_id, author, updated_at FROM content_draft_actions;
DROP TABLE content_draft_actions;
ALTER TABLE content_draft_actions_new RENAME TO content_draft_actions;

-- `bindings.bodies.riders` and `balance.hulls` move into the vehicle rows: every installed pack,
-- the operator's rows, the draft and the publish log. That part runs in code after these
-- statements, in the same transaction (persistence/vehicle-content.ts `moveVehicleContent`).
