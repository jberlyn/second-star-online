-- The High Score Statue's top 10. 1.6 kept `highscore.txt` as `name-points|…` and ranked scores
-- into it; the archive's file is empty (`|||||||||||`), so nothing is imported. Entries key by
-- character id with a copy of the name, like `assassin_table`; no foreign key, so a deleted
-- character's entry stays, as a name stayed in the file.
CREATE TABLE high_scores (
  rank INTEGER PRIMARY KEY CHECK (rank BETWEEN 1 AND 10),
  character_id TEXT NOT NULL,
  name TEXT NOT NULL,
  points INTEGER NOT NULL
);
