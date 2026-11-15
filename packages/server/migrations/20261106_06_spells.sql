-- The spellbook. 1.6 kept it as the spellbook field, saved as encoded ids: at
-- most 29 lines, and Identify (no id) is dropped. Only that saved form is stored here; the live
-- list a session holds can carry a learned Identify until the next save.
CREATE TABLE character_spells (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  line INTEGER NOT NULL CHECK (line BETWEEN 1 AND 29),
  spell TEXT NOT NULL,
  PRIMARY KEY (character_id, line)
);
