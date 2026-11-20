-- Mutes: `/mute` silences an account for a time, like a jail sentence. The moderation log's action
-- list gains mute and unmute, which SQLite can change only by rebuilding the table.
CREATE TABLE moderation_log_new (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL
    CHECK (action IN ('ban', 'unban', 'ipban', 'unipban', 'jail', 'unjail', 'mute', 'unmute',
      'pardon')),
  account_id TEXT,
  character_name TEXT,
  ip_key TEXT,
  address TEXT,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_rank TEXT NOT NULL CHECK (actor_rank IN ('player', 'moderator', 'immortal')),
  reason TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  replaces TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO moderation_log_new SELECT id, action, account_id, character_name, ip_key, address,
  actor_id, actor_name, actor_rank, reason, expires_at, replaces, created_at FROM moderation_log;
DROP TABLE moderation_log;
ALTER TABLE moderation_log_new RENAME TO moderation_log;
CREATE INDEX moderation_log_by_account ON moderation_log (account_id, created_at);
CREATE INDEX moderation_log_by_ip ON moderation_log (ip_key, created_at);
CREATE INDEX moderation_log_by_time ON moderation_log (created_at);

-- A mute is the account's, as a ban is.
CREATE TABLE mutes (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  log_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_rank TEXT NOT NULL CHECK (actor_rank IN ('player', 'moderator', 'immortal')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT
);
