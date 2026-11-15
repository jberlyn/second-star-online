-- Guilds. 1.6 kept a file per guild (the header `<align>-<colour>-*<leader>*`, then the members in
-- join order), `GuildList.txt` (names in creation order) and each character's `Guild` field in its
-- sheet. SSO keeps rows.
--
-- A disbanded guild's row stays with `disbanded = 1` (1.6's file held `!DISBAND!`), so an
-- offline member is told at login; creating that name again reuses the row (1.6 overwrote the
-- file) and lists it last. Names collide ignoring case (1.6 kept one file per name, and Windows
-- file names ignore case).
CREATE TABLE guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  alignment TEXT NOT NULL CHECK (alignment IN ('G', 'N', 'E')),
  -- Always 0: the colour list never reached the screen.
  colour INTEGER NOT NULL DEFAULT 0,
  leader_id TEXT REFERENCES characters (id) ON DELETE SET NULL,
  leader_name TEXT NOT NULL,
  disbanded INTEGER NOT NULL DEFAULT 0 CHECK (disbanded IN (0, 1)),
  -- The order of `GuildList.txt`: set on each create.
  listed_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- The member lines, leader excluded, in join order (`position` 1 first).
CREATE TABLE guild_members (
  guild_id TEXT NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  character_id TEXT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  PRIMARY KEY (guild_id, position)
);
CREATE INDEX guild_members_character ON guild_members (character_id);

-- The character's `Guild` field (TempSave), what its client believed: read at login against the
-- rows to give "You have been kicked out of the <guild>" or "The <guild> has been disband!".
ALTER TABLE characters ADD COLUMN guild TEXT NOT NULL DEFAULT '';
