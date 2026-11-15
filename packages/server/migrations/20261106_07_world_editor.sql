-- The World Editor. A 1.6 map file held 57 `#` fields; earlier migrations stored only the layers
-- and map field 12 items 1, 2, 3 and 5. The editor's save also writes:
--   field 12 items 6-10: fog texture, blend level and colour (`texture:blend:R:G:B`; NoTex,0,255,
--     255,255 when there is no fog);
--   field 13 and 18: exits 1 and 2, `MX:MY:LX:LY:` from the exit panels;
--   fields 14-16: the three sign texts;
--   field 17: the header, already stored as `title`.
-- Item 4 (weather) is always "None": the editor's weather list is off the stage, so 1.6 could never
-- set it, and it is not stored.
-- An exit is NULL when its panel was left empty, else JSON {"mx","my","x","y"}.
ALTER TABLE maps ADD COLUMN exit1 TEXT;
ALTER TABLE maps ADD COLUMN exit2 TEXT;
ALTER TABLE maps ADD COLUMN sign1 TEXT NOT NULL DEFAULT '';
ALTER TABLE maps ADD COLUMN sign2 TEXT NOT NULL DEFAULT '';
ALTER TABLE maps ADD COLUMN sign3 TEXT NOT NULL DEFAULT '';
ALTER TABLE maps ADD COLUMN fog_tex TEXT NOT NULL DEFAULT 'NoTex';
ALTER TABLE maps ADD COLUMN fog_blend INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maps ADD COLUMN fog_r INTEGER NOT NULL DEFAULT 255;
ALTER TABLE maps ADD COLUMN fog_g INTEGER NOT NULL DEFAULT 255;
ALTER TABLE maps ADD COLUMN fog_b INTEGER NOT NULL DEFAULT 255;

-- Every editor save keeps the map as it was before, so an operator's mistake can be undone by
-- hand. `data` is the whole saved map as JSON.
CREATE TABLE map_versions (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  saved_by TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX map_versions_by_map ON map_versions (map_id, created_at);

-- The tile each roster entry was placed on in the editor. 1.6 saved `name:HP:x:y` per slot and LOAD
-- drew the roster there again; the spawner ignores it. NULL for a slot set by `/roster`, which has
-- no tile.
ALTER TABLE map_slots ADD COLUMN home_x INTEGER;
ALTER TABLE map_slots ADD COLUMN home_y INTEGER;
