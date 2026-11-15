-- Bans, the audit log and the cheat log.

-- `/ban`: 1.6 prefixed the character file with "BANNED!!!!!!!!!!!" and the client refused that file
-- at login. SSO flags the account; `/unban` clears it.
ALTER TABLE accounts ADD COLUMN banned_at TEXT;
ALTER TABLE accounts ADD COLUMN banned_by TEXT;

-- `/BanIP` (1.6 wrote `*ip*` to its bans file).
CREATE TABLE ip_bans (
  ip TEXT PRIMARY KEY,
  banned_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Every admin action: who, what, to whom, the value before and after.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  command TEXT NOT NULL,
  target TEXT,
  before TEXT,
  after TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_log_by_time ON audit_log (created_at);

-- Intents an honest client never sends, shown by `/CheatFile` in the form 1.6's cheat list used.
CREATE TABLE cheat_log (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX cheat_log_by_time ON cheat_log (created_at);
