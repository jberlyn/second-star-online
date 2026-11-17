-- Moderation: every ban, IP ban, jail and pardon is logged with its reason, its maker and the
-- maker's rank at that moment; bans and jails can be timed. The active tables say what is in force
-- (a row whose expires_at has passed is not); `moderation_log` keeps the history.

CREATE TABLE moderation_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL
    CHECK (action IN ('ban', 'unban', 'ipban', 'unipban', 'jail', 'unjail', 'pardon')),
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
CREATE INDEX moderation_log_by_account ON moderation_log (account_id, created_at);
CREATE INDEX moderation_log_by_ip ON moderation_log (ip_key, created_at);
CREATE INDEX moderation_log_by_time ON moderation_log (created_at);

CREATE TABLE account_bans (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  log_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_rank TEXT NOT NULL CHECK (actor_rank IN ('player', 'moderator', 'immortal')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT
);

-- A sentence is the character's: the jail is a place.
CREATE TABLE jails (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  log_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_rank TEXT NOT NULL CHECK (actor_rank IN ('player', 'moderator', 'immortal')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT
);

-- Every address an account has played from, for /banip <name> and /banlist.
CREATE TABLE account_addresses (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  logins INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, address)
);
CREATE INDEX account_addresses_by_key ON account_addresses (ip_key, last_seen);

-- Existing bans carry over as permanent, with no reason. The rank at the time was not stored: the
-- banner's role now, at least moderator (only staff could ban); an immortal's when the banner is
-- gone, so a moderator cannot lift a ban whose maker is unknown.
INSERT INTO moderation_log (id, action, account_id, character_name, actor_id, actor_name,
  actor_rank, reason, created_at)
SELECT lower(hex(randomblob(16))), 'ban', a.id,
  (SELECT c.name FROM characters c WHERE c.account_id = a.id LIMIT 1),
  COALESCE(a.banned_by, 'unknown'), COALESCE(b.username, 'unknown'),
  CASE WHEN b.role IS NULL OR b.role = 'immortal' THEN 'immortal' ELSE 'moderator' END,
  '', a.banned_at
FROM accounts a LEFT JOIN accounts b ON b.id = a.banned_by
WHERE a.banned_at IS NOT NULL;

INSERT INTO account_bans (account_id, log_id, actor_id, actor_name, actor_rank, reason,
  created_at, expires_at)
SELECT l.account_id, l.id, l.actor_id, l.actor_name, l.actor_rank, '', l.created_at, NULL
FROM moderation_log l WHERE l.action = 'ban';

ALTER TABLE accounts DROP COLUMN banned_at;
ALTER TABLE accounts DROP COLUMN banned_by;

-- IP bans gain a key (the IPv6 /64), a rank, a reason and an end. The addresses are copied as typed;
-- `normalizeIpBans` (persistence/moderation.ts) puts them in their standard form at startup, since
-- SQL cannot, and removes any that are not addresses.
CREATE TABLE ip_bans_new (
  ip_key TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  source_account_id TEXT,
  log_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_rank TEXT NOT NULL CHECK (actor_rank IN ('player', 'moderator', 'immortal')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT
);
INSERT INTO ip_bans_new (ip_key, address, log_id, actor_id, actor_name, actor_rank, created_at)
SELECT i.ip, i.ip, lower(hex(randomblob(16))), i.banned_by, COALESCE(b.username, 'unknown'),
  'immortal', i.created_at
FROM ip_bans i LEFT JOIN accounts b ON b.id = i.banned_by;
INSERT INTO moderation_log (id, action, ip_key, address, actor_id, actor_name, actor_rank, reason,
  created_at)
SELECT log_id, 'ipban', ip_key, address, actor_id, actor_name, actor_rank, '', created_at
FROM ip_bans_new;
DROP TABLE ip_bans;
ALTER TABLE ip_bans_new RENAME TO ip_bans;

-- Anyone serving a sentence now (a player saved on the jail map; the sentence was only in memory)
-- keeps one: the new default of 10 minutes from the upgrade.
INSERT INTO moderation_log (id, action, account_id, character_name, actor_id, actor_name,
  actor_rank, reason, expires_at, created_at)
SELECT lower(hex(randomblob(16))), 'jail', c.account_id, c.name, 'system', 'system', 'immortal',
  'Carried over', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+600 seconds'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM characters c
JOIN accounts a ON a.id = c.account_id
JOIN maps m ON m.id = c.map_id
WHERE m.mx = 0 AND m.my = 0 AND m.slot = 0 AND a.role = 'player';
INSERT INTO jails (character_id, log_id, actor_id, actor_name, actor_rank, reason, created_at,
  expires_at)
SELECT c.id, l.id, l.actor_id, l.actor_name, l.actor_rank, l.reason, l.created_at, l.expires_at
FROM moderation_log l JOIN characters c ON c.name = l.character_name
WHERE l.action = 'jail';

-- The jail length is now set in minutes (`jailMinutes`); a frame count no longer applies.
DELETE FROM settings WHERE key = 'jailFrames';
