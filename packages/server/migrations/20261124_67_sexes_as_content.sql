-- migrate: foreign_keys off
-- Sexes are content (#37 stage 7): `classes.json` `creation.sexes` lists each sex's code, name and
-- heads, so a world may have other sexes than 1.6's two. `characters.sex` held only 1 or 2; SQLite
-- cannot change a CHECK in place, so the table is rebuilt with the same columns, rows, index and
-- foreign keys, and any code from 1.
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
  vehicle TEXT CHECK (vehicle IN ('Airship', 'Boat', 'Battleship')),
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

-- The creation record gains the sexes. A pack or a change made before had 1.6's two, so it gets
-- Classic's: Male 1 and Female 2 with 1.6's heads. For an imported pack, the operator's row (and
-- the pack row it was made from), the draft, and the rows the publish log keeps for undo.
CREATE TEMP TABLE sexes_67 (value TEXT NOT NULL);
INSERT INTO sexes_67 VALUES
  ('[{"code":1,"label":"Male","heads":[1,3,4,5,6,9,10]},{"code":2,"label":"Female","heads":[2,7,8,11]}]');

UPDATE content_packs
SET data = json_set(data, '$.data.classes.creation.sexes', json((SELECT value FROM sexes_67)))
WHERE data IS NOT NULL AND json_type(data, '$.data.classes.creation') = 'object'
  AND json_type(data, '$.data.classes.creation.sexes') IS NULL;

UPDATE content_rows
SET data = CASE WHEN json_type(data) = 'object' AND json_type(data, '$.sexes') IS NULL
    THEN json_set(data, '$.sexes', json((SELECT value FROM sexes_67))) ELSE data END,
  base_data = CASE WHEN json_type(base_data) = 'object' AND json_type(base_data, '$.sexes') IS NULL
    THEN json_set(base_data, '$.sexes', json((SELECT value FROM sexes_67))) ELSE base_data END,
  -- Worked out again from the base data (persistence/content.ts), which now has the sexes.
  base_hash = CASE WHEN json_type(base_data) = 'object' AND json_type(base_data, '$.sexes') IS NULL
    THEN NULL ELSE base_hash END
WHERE dataset = 'classes' AND part = 'creation';

UPDATE content_draft
SET data = json_set(data, '$.sexes', json((SELECT value FROM sexes_67)))
WHERE dataset = 'classes' AND part = 'creation' AND op = 'set' AND json_type(data) = 'object'
  AND json_type(data, '$.sexes') IS NULL;

UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'classes' AND json_extract(c.value, '$.part') = 'creation'
    THEN json_set(c.value,
      '$.before', json(CASE WHEN json_type(c.value, '$.before') = 'object' THEN json_set(json_extract(c.value, '$.before'),
        '$.data', json(CASE WHEN json_type(json_extract(c.value, '$.before.data')) = 'object' AND json_type(json_extract(c.value, '$.before.data'), '$.sexes') IS NULL
          THEN json_set(json_extract(c.value, '$.before.data'), '$.sexes', json((SELECT value FROM sexes_67))) ELSE json_extract(c.value, '$.before.data') END),
        '$.baseData', json(CASE WHEN json_type(json_extract(c.value, '$.before.baseData')) = 'object' AND json_type(json_extract(c.value, '$.before.baseData'), '$.sexes') IS NULL
          THEN json_set(json_extract(c.value, '$.before.baseData'), '$.sexes', json((SELECT value FROM sexes_67))) ELSE json_extract(c.value, '$.before.baseData') END),
        '$.baseHash', CASE WHEN json_type(json_extract(c.value, '$.before.baseData')) = 'object' AND json_type(json_extract(c.value, '$.before.baseData'), '$.sexes') IS NULL
          THEN NULL ELSE json_extract(c.value, '$.before.baseHash') END)
      ELSE json_extract(c.value, '$.before') END),
      '$.after', json(CASE WHEN json_type(c.value, '$.after') = 'object' THEN json_set(json_extract(c.value, '$.after'),
        '$.data', json(CASE WHEN json_type(json_extract(c.value, '$.after.data')) = 'object' AND json_type(json_extract(c.value, '$.after.data'), '$.sexes') IS NULL
          THEN json_set(json_extract(c.value, '$.after.data'), '$.sexes', json((SELECT value FROM sexes_67))) ELSE json_extract(c.value, '$.after.data') END),
        '$.baseData', json(CASE WHEN json_type(json_extract(c.value, '$.after.baseData')) = 'object' AND json_type(json_extract(c.value, '$.after.baseData'), '$.sexes') IS NULL
          THEN json_set(json_extract(c.value, '$.after.baseData'), '$.sexes', json((SELECT value FROM sexes_67))) ELSE json_extract(c.value, '$.after.baseData') END),
        '$.baseHash', CASE WHEN json_type(json_extract(c.value, '$.after.baseData')) = 'object' AND json_type(json_extract(c.value, '$.after.baseData'), '$.sexes') IS NULL
          THEN NULL ELSE json_extract(c.value, '$.after.baseHash') END)
      ELSE json_extract(c.value, '$.after') END))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'classes' AND json_extract(c.value, '$.part') = 'creation'
);

DROP TABLE sexes_67;
