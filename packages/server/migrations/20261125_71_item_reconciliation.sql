-- Item reconciliation (issue #35): a run counts every item and the gold wherever they are held and
-- compares the count with what the activity log says it should be.
--
-- The activity log is rebuilt so that:
--   - a world event (an item decaying, a quest chest refilled, a house demolished, a plant
--     regrown) can be written with no character: `account_id`, `character_id` and `character`
--     may be null;
--   - every row has a `seq` that only grows (AUTOINCREMENT never reuses one, even once old rows are
--     pruned), so a run reads exactly the rows written since the last run. `id` stays the row's
--     UUIDv7, which the Control Panel pages by. Existing rows keep their order.
CREATE TABLE activity_log_new (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  account_id TEXT,
  character_id TEXT,
  character TEXT,
  other_id TEXT,
  other TEXT,
  item TEXT,
  qty INTEGER NOT NULL DEFAULT 0,
  gold INTEGER NOT NULL DEFAULT 0,
  map TEXT,
  x INTEGER,
  y INTEGER,
  details TEXT
);
INSERT INTO activity_log_new (id, created_at, type, account_id, character_id, character, other_id,
  other, item, qty, gold, map, x, y, details)
SELECT id, created_at, type, account_id, character_id, character, other_id, other, item, qty, gold,
  map, x, y, details
FROM activity_log ORDER BY created_at, id;
DROP TABLE activity_log;
ALTER TABLE activity_log_new RENAME TO activity_log;
CREATE INDEX activity_log_by_character ON activity_log (character_id, created_at, id);
CREATE INDEX activity_log_by_name ON activity_log (character COLLATE NOCASE, created_at, id);
CREATE INDEX activity_log_by_account ON activity_log (account_id, created_at);
CREATE INDEX activity_log_by_other ON activity_log (other_id, created_at);
CREATE INDEX activity_log_by_item ON activity_log (item COLLATE NOCASE, created_at, id);
CREATE INDEX activity_log_by_time ON activity_log (created_at);

-- One reconciliation run: when, who ran it (an account's name, null for the nightly run), the last
-- activity row it read (the next run reads the rows after it) and whether it only took the
-- baseline (the first run).
CREATE TABLE reconcile_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  by_name TEXT,
  last_seq INTEGER NOT NULL,
  baseline INTEGER NOT NULL CHECK (baseline IN (0, 1)),
  items INTEGER NOT NULL,
  mismatches INTEGER NOT NULL
);
CREATE INDEX reconcile_runs_by_time ON reconcile_runs (created_at, id);

-- A run's line for each item (`item_key` is the name in lower case; '' is the currency): the last
-- run's count, what was made, ended and changed unlogged since, what was expected, what was
-- counted and the difference. The next run's baseline is this run's `actual`.
CREATE TABLE reconcile_items (
  run_id TEXT NOT NULL REFERENCES reconcile_runs (id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item TEXT NOT NULL,
  baseline INTEGER NOT NULL,
  made INTEGER NOT NULL,
  ended INTEGER NOT NULL,
  unlogged INTEGER NOT NULL,
  expected INTEGER NOT NULL,
  actual INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  PRIMARY KEY (run_id, item_key)
);

-- The blackjack stakes held at the tables, written with the purses that count them. A restart
-- forgets the tables; after a crash, each stake left here is logged as a refund to its owner,
-- whose saved purse already holds it (a clean shutdown refunds them first and leaves none).
CREATE TABLE casino_holds (
  character_id TEXT PRIMARY KEY,
  gold INTEGER NOT NULL CHECK (gold > 0)
);
