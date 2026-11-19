-- The chat log: every line a player wrote to other players, delivered or refused, for moderation.
-- Rows outlive the character and account that wrote them (no foreign keys); the setting
-- `chatLogRetentionDays` prunes old rows. `id` is a UUIDv7, so it sorts in the order lines arrived.

CREATE TABLE chat_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  target TEXT,
  text TEXT NOT NULL,
  outcome TEXT NOT NULL,
  heard INTEGER,
  ignored INTEGER,
  muffled INTEGER
);
CREATE INDEX chat_log_by_sender ON chat_log (sender COLLATE NOCASE, created_at);
CREATE INDEX chat_log_by_target ON chat_log (target COLLATE NOCASE, created_at);
CREATE INDEX chat_log_by_account ON chat_log (account_id, created_at);
CREATE INDEX chat_log_by_time ON chat_log (created_at);
