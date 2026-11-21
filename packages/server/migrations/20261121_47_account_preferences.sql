-- Per-account player settings (JSON object merged with defaults on load).
-- Also removes the legacy server-wide presence toggles now owned by each player.
CREATE TABLE account_preferences (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

DELETE FROM settings WHERE key IN ('announcePresence', 'presenceChatLines');
