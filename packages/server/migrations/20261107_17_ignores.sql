-- Ignore lists. 1.6 kept an ignore list, line-separated text, for the session only. SSO keeps the
-- same lines per account, shared by its characters and kept across logins, in order with duplicates
-- and any text, at most 100. The whole list is rewritten on each change.
CREATE TABLE ignores (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  entry TEXT NOT NULL,
  PRIMARY KEY (account_id, position)
);
