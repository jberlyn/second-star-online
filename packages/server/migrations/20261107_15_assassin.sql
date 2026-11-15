-- The Assassin's game. 1.6 kept the mode in a file, the per-name totals and wins in files of their
-- own, and the two top-10 files `assassinsscore.txt` / `permassassinsscore.txt`. SSO keeps them as
-- rows; the tables are stored in order because the tie-blind ranking leaves stale entries no total
-- can rebuild, each entry an id with a copy of the name. Nothing is seeded: the archive's all-time
-- table is not carried over.
CREATE TABLE assassin_game (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL CHECK (mode IN ('GO', 'LIGHTNING', 'STOP'))
);

-- `current` = assassinsscore.txt, `legend` = permassassinsscore.txt; rank 1-10.
CREATE TABLE assassin_table (
  kind TEXT NOT NULL CHECK (kind IN ('current', 'legend')),
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 10),
  character_id TEXT NOT NULL,
  name TEXT NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (kind, rank)
);

-- Points this game per character (reset at each start for everyone listed).
CREATE TABLE assassin_scores (
  character_id TEXT PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK (points >= 0)
);

-- Games won per character (never reset).
CREATE TABLE assassin_legends (
  character_id TEXT PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
  wins INTEGER NOT NULL CHECK (wins >= 0)
);
