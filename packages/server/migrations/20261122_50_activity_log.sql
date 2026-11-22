-- The player activity log (issue #25): item and gold movements, kills and deaths, progression and
-- sessions, for tracing abuse, exploits and real-money trading. Like chat_log, rows outlive the
-- characters and accounts they name (no foreign keys), `id` is a UUIDv7 so rows sort in the order
-- they happened, and the setting `activityLogRetention` prunes old rows.
--
-- Each row is one character's view of one event: `qty` and `gold` are signed changes to what that
-- character carries (bag, worn gear and gold in hand), so a trade is two rows, one per side.
-- `other` names the other party: a player (with `other_id`), an NPC, a monster or a container.
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  account_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  character TEXT NOT NULL,
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
-- The id ends each index the Control Panel pages through, so a page seeks straight to the row
-- after the last one shown, newest first.
CREATE INDEX activity_log_by_character ON activity_log (character_id, created_at, id);
CREATE INDEX activity_log_by_name ON activity_log (character COLLATE NOCASE, created_at, id);
CREATE INDEX activity_log_by_account ON activity_log (account_id, created_at);
CREATE INDEX activity_log_by_other ON activity_log (other_id, created_at);
CREATE INDEX activity_log_by_item ON activity_log (item COLLATE NOCASE, created_at, id);
CREATE INDEX activity_log_by_time ON activity_log (created_at);

-- Who dropped or gave a ground item, so picking up another player's drop names them.
ALTER TABLE ground_items ADD COLUMN dropped_by_id TEXT;
ALTER TABLE ground_items ADD COLUMN dropped_by TEXT;
