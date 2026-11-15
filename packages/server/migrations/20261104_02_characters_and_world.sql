-- Characters and the world.
-- Primary keys are UUIDv7 text (Bun.randomUUIDv7()). Rows that are only a value of their
-- parent use the parent's key: character_skills (character, skill number), settings (name).

-- One account owns its characters. Play is one character per account, created together
-- (the original's creation screen asked for name and password, frame 25), but the tables
-- allow more later.
CREATE TABLE characters (
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
  medals TEXT NOT NULL,
  hunger INTEGER NOT NULL,
  break_count INTEGER NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  facing TEXT NOT NULL CHECK (facing IN ('N', 'S', 'E', 'W')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX characters_account ON characters(account_id);

-- The 38 skills, by index (classes.json `skills`).
CREATE TABLE character_skills (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill INTEGER NOT NULL CHECK (skill BETWEEN 1 AND 38),
  value INTEGER NOT NULL,
  PRIMARY KEY (character_id, skill)
);

-- Bag lines: the starting kit, and the inventory built on it.
CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  item TEXT NOT NULL,
  qty INTEGER NOT NULL,
  UNIQUE (character_id, slot)
);

-- Maps are addressed by their grid position, shown as x<mx>y<my>.
-- Layers hold 12 rows of 17 tile codes each, as a JSON array of strings.
CREATE TABLE maps (
  id TEXT PRIMARY KEY,
  mx INTEGER NOT NULL,
  my INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  layer1 TEXT NOT NULL,
  layer2 TEXT NOT NULL,
  layer3 TEXT NOT NULL,
  layer4 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (mx, my)
);

-- Operator overrides of the typed settings (server/src/settings.ts holds the defaults).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The seed map: grass and trees at x1000y992, the grid position new characters start on in the
-- original.
-- Layer 1: G1 grass, the World Editor's default ground tile (tiles.json specialCodes);
--   walkable (tiles.json catalogue).
-- Layer 2: G3, the empty object tile, with S3 trees: the tree the Axe cuts to a P3 stump
--   (tiles.json specialCodes). S3 is not on the walkable whitelist.
-- Layer 3: G3; layer 4: 5A, the empty shadow tile.
-- No tree on the start tile (6,4) or the respawn tile (5,5); every edge is reachable.
INSERT INTO maps (id, mx, my, title, layer1, layer2, layer3, layer4, created_at, updated_at)
VALUES ('01a1a613-69ff-72dc-8025-af4ca595e963', 1000, 992, '',
  '["G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1", "G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1"]',
  '["G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 S3 S3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 S3 G3 G3 G3", "G3 S3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 S3 S3 S3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 S3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 S3 S3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 S3 S3 G3 G3 G3 G3 G3 G3", "G3 G3 S3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 S3 G3", "G3 S3 S3 S3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 S3 S3 G3", "G3 G3 S3 G3 G3 G3 G3 G3 G3 G3 G3 S3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3"]',
  '["G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3", "G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3 G3"]',
  '["5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A", "5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A 5A"]',
  '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');
