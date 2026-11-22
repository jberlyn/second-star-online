-- Agility, Speed and Aim are gone. 1.6 saved them, but its creation screen left them at 1 and
-- nothing in the game raised them; only Speed was ever read (by the regen timer), and the game now
-- works that out as Speed 1. Character editor log rows that changed them keep their text; an undo
-- passes over those fields.
ALTER TABLE characters DROP COLUMN agi;
ALTER TABLE characters DROP COLUMN spd;
ALTER TABLE characters DROP COLUMN aim;

-- A class's stat points no longer take Agility or Speed: the operator's class changes, the draft
-- and an imported pack's classes lose those keys, so the content still matches its schema at the
-- next start. Running it again changes nothing.
UPDATE content_rows
SET data = json_remove(data, '$.statBonus.agi', '$.statBonus.spd'),
  base_data = json_remove(base_data, '$.statBonus.agi', '$.statBonus.spd')
WHERE dataset = 'classes' AND part = 'classes';
UPDATE content_draft SET data = json_remove(data, '$.statBonus.agi', '$.statBonus.spd')
WHERE dataset = 'classes' AND part = 'classes';
UPDATE content_packs
SET data = json_set(data, '$.data.classes.classes', (
  SELECT json_group_array(json(json_remove(value, '$.statBonus.agi', '$.statBonus.spd')))
  FROM json_each(content_packs.data, '$.data.classes.classes')
))
WHERE source = 'imported' AND json_type(data, '$.data.classes.classes') = 'array';
