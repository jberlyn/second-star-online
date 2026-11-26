-- The recipes a character has learned from a recipe book (issue #45): only recipes that name a
-- book need learning, so a world without them (Classic) never writes a row.
CREATE TABLE character_recipes (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  recipe TEXT NOT NULL,
  PRIMARY KEY (character_id, recipe)
);
