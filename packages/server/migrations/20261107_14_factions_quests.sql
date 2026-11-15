-- Factions, the murder flag and quests. 1.6 kept `Fctnme:Fctcnt` in sheet item 5 and `gnL` in item
-- 8; SSO keeps them as columns the server owns (faction membership, power and the murder flag are
-- server-only).
ALTER TABLE characters ADD COLUMN faction INTEGER NOT NULL DEFAULT 0 CHECK (faction BETWEEN 0 AND 3);
ALTER TABLE characters ADD COLUMN faction_count INTEGER NOT NULL DEFAULT 0 CHECK (faction_count >= 0);
ALTER TABLE characters ADD COLUMN wanted INTEGER NOT NULL DEFAULT 0 CHECK (wanted IN (0, 1));

-- 1.6's faction power file = mage:warrior:adventurer. One row; the server seeds it from the
-- archive's 27:123:0 the first time it starts.
CREATE TABLE faction_powers (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mage INTEGER NOT NULL,
  warrior INTEGER NOT NULL,
  adventurer INTEGER NOT NULL
);

-- 1.6's quest file, lines 1-40 (`NPC:wants:reward`). The server seeds it from the archive's lines
-- and rewrites a line after each turn-in (server state, no settings form). An empty line is ''.
CREATE TABLE quests (
  line INTEGER PRIMARY KEY CHECK (line BETWEEN 1 AND 40),
  text TEXT NOT NULL
);
