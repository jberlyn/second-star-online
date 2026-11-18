-- A spellbook is saved in full: every spell a character knows, Identify included. 1.6 saved at
-- most 29 lines as encode ids, so the table capped `line` at 29; drop the cap.
CREATE TABLE character_spells_new (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  line INTEGER NOT NULL CHECK (line >= 1),
  spell TEXT NOT NULL,
  PRIMARY KEY (character_id, line)
);
INSERT INTO character_spells_new (character_id, line, spell)
  SELECT character_id, line, spell FROM character_spells;
DROP TABLE character_spells;
ALTER TABLE character_spells_new RENAME TO character_spells;
