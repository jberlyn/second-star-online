-- The live content store (issue #27): installed packs, the operator layer, the shared draft and
-- the publish log.
--
-- `content_packs` lists the installed packs in load order (`position`). A pack shipped in the
-- release (`source = 'release'`, the Classic pack) is read from the release image, never copied
-- here, so a release fix reaches it; `version` is the version the server last loaded, which the
-- server updates when a release ships a newer one. A pack imported from elsewhere
-- (`source = 'imported'`) keeps its manifest and data in `data` as a read-only layer, so a
-- database backup includes it. Every existing server is migrated as "Classic installed", with
-- the version filled in at the next start.
CREATE TABLE content_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT,
  position INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('release', 'imported')),
  data TEXT,
  installed_at TEXT NOT NULL
);
INSERT INTO content_packs (id, name, version, position, source, data, installed_at)
VALUES ('classic', 'Classic', NULL, 0, 'release', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- The operator layer: one row per changed pack row or added row. `part` is the dataset's
-- top-level field; `row_key` is the entry's key in a keyed list (an item's name), or '' for a
-- whole field. `op` is 'set' (the row's JSON is `data`) or 'remove' (a marker: the row is
-- dropped). `base_hash` and `base_data` are the pack row the change was based on (null for an
-- added row), so a later pack version that changes that row shows a notice. `seq` keeps added
-- rows in the order they were made.
CREATE TABLE content_rows (
  dataset TEXT NOT NULL,
  part TEXT NOT NULL,
  row_key TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('set', 'remove')),
  data TEXT,
  base_hash TEXT,
  base_data TEXT,
  seq INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset, part, row_key)
);

-- The one shared draft: pending changes, each tagged with its author, in the same shape.
CREATE TABLE content_draft (
  dataset TEXT NOT NULL,
  part TEXT NOT NULL,
  row_key TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('set', 'remove', 'revert')),
  data TEXT,
  author_account_id TEXT NOT NULL,
  author TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset, part, row_key)
);

-- The publish log: one entry per publish, with each row's operator-layer state before and after
-- (`changes`, a JSON list of {dataset, part, key, before, after}), so a publish can be undone as
-- a whole. An undo is a publish of its own: `undo_of` names the publish it undid, and that
-- publish's `undone_by` names the undo. `hash` is the store the publish produced.
CREATE TABLE content_publishes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_account_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes TEXT NOT NULL,
  hash TEXT NOT NULL,
  undo_of TEXT,
  undone_by TEXT
);
