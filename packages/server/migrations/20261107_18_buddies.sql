-- Buddy lists. 1.6 kept the buddy list as one `:a:b:` string in a local pref named after the
-- server's address, so every character played on that PC shared it. SSO keeps the items between the
-- colons per account, shared by its characters and kept across logins, in order, as typed, with no
-- limit. The whole list is rewritten on each change.
CREATE TABLE buddies (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  entry TEXT NOT NULL,
  PRIMARY KEY (account_id, position)
);

-- New characters were created with medals "0:0:0:0:0:0", which is sheet item 8 (`gnL`); item 10,
-- the medals, is written empty. Nothing earned a medal before this migration, so every such value
-- is the wrong default.
UPDATE characters SET medals = '' WHERE medals = '0:0:0:0:0:0';
