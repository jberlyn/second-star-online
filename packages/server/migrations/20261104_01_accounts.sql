-- Accounts.
-- Roles live on the account row, never in a name prefix (closes `gm_*`).
-- Username rules and bans arrive with later migrations.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'immortal')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
