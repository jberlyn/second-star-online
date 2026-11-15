-- migrate: foreign_keys off
-- Housing.
--
-- House interiors are maps named `xH<slot><mx>yH<slot><my>` after the outdoor map and its exit
-- slot, so a map is now its grid position plus a house slot: 0 for the grid map, 1 or 2 for the
-- interior behind that map's Exit or Exit2 (SSO names the interiors as maps). SQLite cannot change
-- a UNIQUE constraint in place, so the table is rebuilt (the runner turns foreign keys off for this
-- migration).
CREATE TABLE maps_new (
  id TEXT PRIMARY KEY,
  mx INTEGER NOT NULL,
  my INTEGER NOT NULL,
  slot INTEGER NOT NULL DEFAULT 0 CHECK (slot IN (0, 1, 2)),
  title TEXT NOT NULL DEFAULT '',
  layer1 TEXT NOT NULL,
  layer2 TEXT NOT NULL,
  layer3 TEXT NOT NULL,
  layer4 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  can_fight TEXT NOT NULL DEFAULT 'X',
  fct_spwn TEXT NOT NULL DEFAULT 'X',
  is_indoors TEXT NOT NULL DEFAULT 'X',
  can_pvp TEXT NOT NULL DEFAULT 'X',
  exit1 TEXT,
  exit2 TEXT,
  sign1 TEXT NOT NULL DEFAULT '',
  sign2 TEXT NOT NULL DEFAULT '',
  sign3 TEXT NOT NULL DEFAULT '',
  fog_tex TEXT NOT NULL DEFAULT 'NoTex',
  fog_blend INTEGER NOT NULL DEFAULT 0,
  fog_r INTEGER NOT NULL DEFAULT 255,
  fog_g INTEGER NOT NULL DEFAULT 255,
  fog_b INTEGER NOT NULL DEFAULT 255,
  UNIQUE (mx, my, slot)
);
INSERT INTO maps_new (id, mx, my, slot, title, layer1, layer2, layer3, layer4, created_at,
  updated_at, can_fight, fct_spwn, is_indoors, can_pvp, exit1, exit2, sign1, sign2, sign3,
  fog_tex, fog_blend, fog_r, fog_g, fog_b)
SELECT id, mx, my, 0, title, layer1, layer2, layer3, layer4, created_at, updated_at, can_fight,
  fct_spwn, is_indoors, can_pvp, exit1, exit2, sign1, sign2, sign3, fog_tex, fog_blend, fog_r,
  fog_g, fog_b
FROM maps;
DROP TABLE maps;
ALTER TABLE maps_new RENAME TO maps;

-- The blueprint, 1.6's file per owner and outdoor map: one per owner and map, overwritten by a
-- second house on the same map (a kept 1.6 bug). `item1` is the mailbox or lamp entry (empty for
-- halls), `item2` the exit, each `name:x:y` as recorded; `tiles` is a JSON list of [code, x, y].
CREATE TABLE houses (
  owner_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  map_name TEXT NOT NULL,
  item1 TEXT NOT NULL,
  item2 TEXT NOT NULL,
  tiles TEXT NOT NULL,
  -- The interior this blueprint built (deleted with it by decay).
  interior TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, map_name)
);

-- `houselist.txt`: `*<user>+<map>+<month>|` entries in order, appended on every
-- build with no check, so duplicates are kept. `owner_name` is the name the entry was written
-- under, which the sweep matches (the name must occur between "*" and "+").
CREATE TABLE house_list (
  position INTEGER PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  map_name TEXT NOT NULL,
  month TEXT NOT NULL
);
