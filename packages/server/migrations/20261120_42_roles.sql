-- migrate: foreign_keys off
-- Configurable roles (issue #7): the operator's roles live here, each a display name, a rank and
-- its permissions (a JSON array of shared `PERMISSIONS`). An account holds at most one role; none
-- is an ordinary player. `immortal` becomes `administrator` and `player` becomes no role.
--
-- The seeds match shared `DEFAULT_ROLES`. A permission added later reaches existing roles only
-- through a migration of its own.
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 1),
  permissions TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO roles (id, name, rank, permissions, created_at, updated_at) VALUES
  ('moderator', 'Moderator', 1,
    '["save","refresh","inventory","location","iplookup","kick","ban","jail","pardon","unban","unjail","banlist","mute","unmute","bypassLoginLimits"]',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('administrator', 'Admin', 2,
    '["save","refresh","cheatfile","unbanip","inventory","banip","location","iplookup","kick","warpscript","ban","warp","jail","pardon","warptome","warpmeto","unban","setclass","unjail","banlist","chatlog","auditlog","mute","unmute","drop","spawn","roster","worldEditor","npcEditor","settings","adminChat","assassinGame","overrule","pardonSelf","warpSelf","invulnerable","noHunger","unpushable","noHighScores","bypassIpBan","bypassLoginLimits","dropOnEveryDeath","bypassChatCooldown","bypassBroadcastCooldown"]',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- The role column names a row above, or is NULL for a player; deleting a role clears it.
CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT REFERENCES roles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO accounts_new (id, username, password_hash, role, created_at, updated_at)
SELECT id, username, password_hash,
  CASE role WHEN 'immortal' THEN 'administrator' WHEN 'moderator' THEN 'moderator' END,
  created_at, updated_at
FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

-- Moderation rows kept the actor's fixed role in `actor_rank`; they now keep the name of the role
-- the actor held (`actor_role`), whatever the operator has called it.
CREATE TABLE account_bans_new (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  log_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT
);
INSERT INTO account_bans_new SELECT account_id, log_id, actor_id, actor_name,
  CASE actor_rank WHEN 'immortal' THEN 'Admin' WHEN 'moderator' THEN 'Moderator' ELSE 'Player' END,
  reason, created_at, expires_at FROM account_bans;
DROP TABLE account_bans;
ALTER TABLE account_bans_new RENAME TO account_bans;

CREATE TABLE jails_new (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  log_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT
);
INSERT INTO jails_new SELECT character_id, log_id, actor_id, actor_name,
  CASE actor_rank WHEN 'immortal' THEN 'Admin' WHEN 'moderator' THEN 'Moderator' ELSE 'Player' END,
  reason, created_at, expires_at FROM jails;
DROP TABLE jails;
ALTER TABLE jails_new RENAME TO jails;

CREATE TABLE mutes_new (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  log_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT
);
INSERT INTO mutes_new SELECT account_id, log_id, actor_id, actor_name,
  CASE actor_rank WHEN 'immortal' THEN 'Admin' WHEN 'moderator' THEN 'Moderator' ELSE 'Player' END,
  reason, created_at, expires_at FROM mutes;
DROP TABLE mutes;
ALTER TABLE mutes_new RENAME TO mutes;

CREATE TABLE ip_bans_new (
  ip_key TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  source_account_id TEXT,
  log_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT
);
INSERT INTO ip_bans_new SELECT ip_key, address, source_account_id, log_id, actor_id, actor_name,
  CASE actor_rank WHEN 'immortal' THEN 'Admin' WHEN 'moderator' THEN 'Moderator' ELSE 'Player' END,
  reason, created_at, expires_at FROM ip_bans;
DROP TABLE ip_bans;
ALTER TABLE ip_bans_new RENAME TO ip_bans;

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
  actor_role TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  replaces TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO moderation_log_new SELECT id, action, account_id, character_name, ip_key, address,
  actor_id, actor_name,
  CASE actor_rank WHEN 'immortal' THEN 'Admin' WHEN 'moderator' THEN 'Moderator' ELSE 'Player' END,
  reason, expires_at, replaces, created_at FROM moderation_log;
DROP TABLE moderation_log;
ALTER TABLE moderation_log_new RENAME TO moderation_log;
CREATE INDEX moderation_log_by_account ON moderation_log (account_id, created_at);
CREATE INDEX moderation_log_by_ip ON moderation_log (ip_key, created_at);
CREATE INDEX moderation_log_by_time ON moderation_log (created_at);
