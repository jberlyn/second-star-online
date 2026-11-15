-- migrate: foreign_keys off
-- Skills are open-ended: the content files may list skills after 1.6's 38, so the skill number
-- has no upper bound. SQLite cannot drop a CHECK in place, so the table is rebuilt.
CREATE TABLE character_skills_new (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill INTEGER NOT NULL CHECK (skill >= 1),
  value INTEGER NOT NULL,
  PRIMARY KEY (character_id, skill)
);
INSERT INTO character_skills_new (character_id, skill, value)
  SELECT character_id, skill, value FROM character_skills;
DROP TABLE character_skills;
ALTER TABLE character_skills_new RENAME TO character_skills;
