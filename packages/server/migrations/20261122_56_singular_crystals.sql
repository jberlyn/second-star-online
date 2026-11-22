-- Crystals are named in the singular, like every other item (issue #39): "Blue Crystal", not
-- "Blue Crystals". The Classic pack's plural entries became the singular items (the plurals stay as
-- archived spellings) and its artless duplicates went, Coched's "red crystal" among them. The
-- artless "Damaged Sword, Knight's" (1.6's broken Knight's Sword, which never repaired) went too:
-- its copies become "Damaged Sword, Knight", which repairs into the same sword.
--
-- This renames the copies a server has saved, in any case, and merges a bag stack that now shares
-- its name with another line, as any stack merges. Text that names them (NPC files and their
-- versions, quest lines, map versions, the operator's content rows and draft) is rewritten in the
-- spellings the archive used; a copy in any other spelling still works as a crystal and picks up
-- singular. Running it again changes nothing in the world.

CREATE TEMP TABLE renamed (old TEXT PRIMARY KEY, new TEXT NOT NULL);
INSERT INTO renamed (old, new) VALUES
  ('blue crystals', 'Blue Crystal'),
  ('blue crystal', 'Blue Crystal'),
  ('red crystals', 'Red Crystal'),
  ('red crystal', 'Red Crystal'),
  ('green crystals', 'Green Crystal'),
  ('green crystal', 'Green Crystal'),
  ('yellow crystals', 'Yellow Crystal'),
  ('yellow crystal', 'Yellow Crystal'),
  ('purple crystals', 'Purple Crystal'),
  ('purple crystal', 'Purple Crystal'),
  ('white crystals', 'White Crystal'),
  ('white crystal', 'White Crystal'),
  ('damaged sword, knight''s', 'Damaged Sword, Knight');

UPDATE inventory SET item = (SELECT new FROM renamed WHERE old = lower(inventory.item))
WHERE lower(item) IN (SELECT old FROM renamed);

UPDATE equipment SET item = (SELECT new FROM renamed WHERE old = lower(equipment.item))
WHERE lower(item) IN (SELECT old FROM renamed);

UPDATE vault_items SET item = (SELECT new FROM renamed WHERE old = lower(vault_items.item))
WHERE lower(item) IN (SELECT old FROM renamed);

UPDATE container_items SET item = (SELECT new FROM renamed WHERE old = lower(container_items.item))
WHERE lower(item) IN (SELECT old FROM renamed);

UPDATE ground_items SET item = (SELECT new FROM renamed WHERE old = lower(ground_items.item))
WHERE lower(item) IN (SELECT old FROM renamed);

UPDATE npc_shop_lines SET item = (SELECT new FROM renamed WHERE old = lower(npc_shop_lines.item))
WHERE lower(item) IN (SELECT old FROM renamed);

-- A crystal pile carries its count in its name: "20 Blue Crystals" is "20 Blue Crystal".
UPDATE ground_items
SET item = substr(item, 1, instr(item, ' '))
  || (SELECT new FROM renamed WHERE old = lower(substr(ground_items.item, instr(ground_items.item, ' ') + 1)))
WHERE instr(item, ' ') > 1
  AND substr(item, 1, instr(item, ' ') - 1) NOT GLOB '*[^0-9]*'
  AND lower(substr(item, instr(item, ' ') + 1)) IN (SELECT old FROM renamed WHERE new LIKE '% Crystal');

-- One bag line per name: the stacks of a renamed item merge into its first line.
UPDATE inventory SET qty = (
  SELECT SUM(o.qty) FROM inventory o
  WHERE o.character_id = inventory.character_id AND o.item = inventory.item
)
WHERE item IN (SELECT new FROM renamed)
  AND slot = (
    SELECT MIN(o.slot) FROM inventory o
    WHERE o.character_id = inventory.character_id AND o.item = inventory.item
  );
DELETE FROM inventory
WHERE item IN (SELECT new FROM renamed)
  AND slot > (
    SELECT MIN(o.slot) FROM inventory o
    WHERE o.character_id = inventory.character_id AND o.item = inventory.item
  );

-- The operator's changes to the items that left the pack (the artless singular crystals and the
-- Knight's sword) go with them: a removal, an edit of an entry with no icon, or any change to an
-- entry whose new key another change already takes (the plural crystal's, or the Knight sword's).
-- The other changes follow their items to the new keys, with a removal's waiting world cleanup.
DELETE FROM content_rows
WHERE dataset = 'items' AND part = 'items'
  AND lower(row_key) IN (SELECT old FROM renamed WHERE old NOT LIKE '% crystals')
  AND (op = 'remove' OR json_extract(data, '$.icon') IS NULL OR EXISTS (
    SELECT 1 FROM content_rows p
    WHERE p.dataset = 'items' AND p.part = 'items' AND lower(p.row_key) <> lower(content_rows.row_key)
      AND lower(coalesce((SELECT new FROM renamed WHERE old = lower(p.row_key)), p.row_key))
        = lower((SELECT new FROM renamed WHERE old = lower(content_rows.row_key)))
  ));
DELETE FROM content_draft
WHERE dataset = 'items' AND part = 'items'
  AND lower(row_key) IN (SELECT old FROM renamed WHERE old NOT LIKE '% crystals')
  AND (op <> 'set' OR json_extract(data, '$.icon') IS NULL OR EXISTS (
    SELECT 1 FROM content_draft p
    WHERE p.dataset = 'items' AND p.part = 'items' AND lower(p.row_key) <> lower(content_draft.row_key)
      AND lower(coalesce((SELECT new FROM renamed WHERE old = lower(p.row_key)), p.row_key))
        = lower((SELECT new FROM renamed WHERE old = lower(content_draft.row_key)))
  ));
DELETE FROM content_draft_actions
WHERE kind = 'item'
  AND lower(entry_key) IN (SELECT old FROM renamed WHERE old NOT LIKE '% crystals')
  AND (lower(entry_key) NOT IN (
    SELECT lower(row_key) FROM content_draft WHERE dataset = 'items' AND part = 'items'
  ) OR EXISTS (
    SELECT 1 FROM content_draft_actions p
    WHERE p.kind = 'item' AND lower(p.entry_key) <> lower(content_draft_actions.entry_key)
      AND lower(coalesce((SELECT new FROM renamed WHERE old = lower(p.entry_key)), p.entry_key))
        = lower((SELECT new FROM renamed WHERE old = lower(content_draft_actions.entry_key)))
  ));
UPDATE content_rows SET row_key = (SELECT new FROM renamed WHERE old = lower(content_rows.row_key))
WHERE dataset = 'items' AND part = 'items' AND lower(row_key) IN (SELECT old FROM renamed);
UPDATE content_draft SET row_key = (SELECT new FROM renamed WHERE old = lower(content_draft.row_key))
WHERE dataset = 'items' AND part = 'items' AND lower(row_key) IN (SELECT old FROM renamed);
UPDATE content_draft_actions
SET entry_key = (SELECT new FROM renamed WHERE old = lower(content_draft_actions.entry_key))
WHERE kind = 'item' AND lower(entry_key) IN (SELECT old FROM renamed);

-- A changed crystal replaces the pack's row whole, so it takes the pack's new name, archived
-- spellings and, drawn with the original art, the plural's picture (`sprite`).
CREATE TEMP TABLE crystal_rows (name TEXT PRIMARY KEY, variants TEXT NOT NULL);
INSERT INTO crystal_rows (name, variants) VALUES
  ('Blue Crystal', '["Blue Crystals","Blue crystals","blue crystals"]'),
  ('Green Crystal', '["Green Crystals","Green crystals"]'),
  ('Purple Crystal', '["Purple Crystals"]'),
  ('Red Crystal', '["Red Crystals"]'),
  ('White Crystal', '["White Crystals","White crystals"]'),
  ('Yellow Crystal', '["Yellow Crystals"]');
UPDATE content_rows
SET data = json_set(
  data,
  '$.name', row_key,
  '$.variants', json((SELECT variants FROM crystal_rows WHERE name = content_rows.row_key))
)
WHERE dataset = 'items' AND part = 'items' AND data IS NOT NULL
  AND row_key IN (SELECT name FROM crystal_rows);
UPDATE content_rows SET data = json_set(data, '$.sprite', row_key || 's')
WHERE dataset = 'items' AND part = 'items' AND data IS NOT NULL
  AND row_key IN (SELECT name FROM crystal_rows)
  AND json_type(data, '$.icon') = 'object' AND json_extract(data, '$.sprite') IS NULL;
UPDATE content_draft
SET data = json_set(
  data,
  '$.name', row_key,
  '$.variants', json((SELECT variants FROM crystal_rows WHERE name = content_draft.row_key))
)
WHERE dataset = 'items' AND part = 'items' AND data IS NOT NULL
  AND row_key IN (SELECT name FROM crystal_rows);
UPDATE content_draft SET data = json_set(data, '$.sprite', row_key || 's')
WHERE dataset = 'items' AND part = 'items' AND data IS NOT NULL
  AND row_key IN (SELECT name FROM crystal_rows)
  AND json_type(data, '$.icon') = 'object' AND json_extract(data, '$.sprite') IS NULL;
DROP TABLE crystal_rows;
UPDATE content_rows SET data = json_set(data, '$.name', row_key)
WHERE dataset = 'items' AND part = 'items' AND row_key = 'Damaged Sword, Knight' AND data IS NOT NULL;
UPDATE content_draft SET data = json_set(data, '$.name', row_key)
WHERE dataset = 'items' AND part = 'items' AND row_key = 'Damaged Sword, Knight' AND data IS NOT NULL;

DROP TABLE renamed;

-- NPC files and their saved versions: the item of a shop or drop line (`SEL|Blue Crystals:7:9`,
-- `INV|5 Blue Crystals:15`) ends at its colon.
UPDATE npc_files SET text = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(text, 'Blue Crystals:', 'Blue Crystal:'), 'Blue crystals:', 'Blue Crystal:'), 'blue crystals:', 'Blue Crystal:'), 'Red Crystals:', 'Red Crystal:'), 'Red crystals:', 'Red Crystal:'), 'red crystals:', 'Red Crystal:'), 'Green Crystals:', 'Green Crystal:'), 'Green crystals:', 'Green Crystal:'), 'green crystals:', 'Green Crystal:'), 'Yellow Crystals:', 'Yellow Crystal:'), 'Yellow crystals:', 'Yellow Crystal:'), 'yellow crystals:', 'Yellow Crystal:'), 'Purple Crystals:', 'Purple Crystal:'), 'Purple crystals:', 'Purple Crystal:'), 'purple crystals:', 'Purple Crystal:'), 'White Crystals:', 'White Crystal:'), 'White crystals:', 'White Crystal:'), 'white crystals:', 'White Crystal:'), 'red crystal:', 'Red Crystal:'), 'Damaged Sword, Knight''s:', 'Damaged Sword, Knight:');

UPDATE npc_file_versions SET text = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(text, 'Blue Crystals:', 'Blue Crystal:'), 'Blue crystals:', 'Blue Crystal:'), 'blue crystals:', 'Blue Crystal:'), 'Red Crystals:', 'Red Crystal:'), 'Red crystals:', 'Red Crystal:'), 'red crystals:', 'Red Crystal:'), 'Green Crystals:', 'Green Crystal:'), 'Green crystals:', 'Green Crystal:'), 'green crystals:', 'Green Crystal:'), 'Yellow Crystals:', 'Yellow Crystal:'), 'Yellow crystals:', 'Yellow Crystal:'), 'yellow crystals:', 'Yellow Crystal:'), 'Purple Crystals:', 'Purple Crystal:'), 'Purple crystals:', 'Purple Crystal:'), 'purple crystals:', 'Purple Crystal:'), 'White Crystals:', 'White Crystal:'), 'White crystals:', 'White Crystal:'), 'white crystals:', 'White Crystal:'), 'red crystal:', 'Red Crystal:'), 'Damaged Sword, Knight''s:', 'Damaged Sword, Knight:');

-- Quest lines, `<npc>:<wants>:<reward>`: with a colon added, each item ends at one.
UPDATE quests SET text = (
  SELECT substr(x, 1, length(x) - 1)
  FROM (SELECT replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(quests.text || ':', 'Blue Crystals:', 'Blue Crystal:'), 'Blue crystals:', 'Blue Crystal:'), 'blue crystals:', 'Blue Crystal:'), 'Red Crystals:', 'Red Crystal:'), 'Red crystals:', 'Red Crystal:'), 'red crystals:', 'Red Crystal:'), 'Green Crystals:', 'Green Crystal:'), 'Green crystals:', 'Green Crystal:'), 'green crystals:', 'Green Crystal:'), 'Yellow Crystals:', 'Yellow Crystal:'), 'Yellow crystals:', 'Yellow Crystal:'), 'yellow crystals:', 'Yellow Crystal:'), 'Purple Crystals:', 'Purple Crystal:'), 'Purple crystals:', 'Purple Crystal:'), 'purple crystals:', 'Purple Crystal:'), 'White Crystals:', 'White Crystal:'), 'White crystals:', 'White Crystal:'), 'white crystals:', 'White Crystal:'), 'red crystal:', 'Red Crystal:'), 'Damaged Sword, Knight''s:', 'Damaged Sword, Knight:') AS x)
);

-- Map versions (their placed items), the operator's other content rows and draft: JSON strings,
-- which end at a quote ("20 Blue Crystals"), and the NPC files among them, whose lines end at a
-- colon. A row's pack base (`base_data`) is left as it was, so the Content page shows what the
-- pack changed under it.
UPDATE map_versions SET data = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(data, 'Blue Crystals"', 'Blue Crystal"'), 'Blue crystals"', 'Blue Crystal"'), 'blue crystals"', 'Blue Crystal"'), 'Red Crystals"', 'Red Crystal"'), 'Red crystals"', 'Red Crystal"'), 'red crystals"', 'Red Crystal"'), 'Green Crystals"', 'Green Crystal"'), 'Green crystals"', 'Green Crystal"'), 'green crystals"', 'Green Crystal"'), 'Yellow Crystals"', 'Yellow Crystal"'), 'Yellow crystals"', 'Yellow Crystal"'), 'yellow crystals"', 'Yellow Crystal"'), 'Purple Crystals"', 'Purple Crystal"'), 'Purple crystals"', 'Purple Crystal"'), 'purple crystals"', 'Purple Crystal"'), 'White Crystals"', 'White Crystal"'), 'White crystals"', 'White Crystal"'), 'white crystals"', 'White Crystal"'), 'red crystal"', 'Red Crystal"'), 'Damaged Sword, Knight''s"', 'Damaged Sword, Knight"'), 'Blue Crystals:', 'Blue Crystal:'), 'Blue crystals:', 'Blue Crystal:'), 'blue crystals:', 'Blue Crystal:'), 'Red Crystals:', 'Red Crystal:'), 'Red crystals:', 'Red Crystal:'), 'red crystals:', 'Red Crystal:'), 'Green Crystals:', 'Green Crystal:'), 'Green crystals:', 'Green Crystal:'), 'green crystals:', 'Green Crystal:'), 'Yellow Crystals:', 'Yellow Crystal:'), 'Yellow crystals:', 'Yellow Crystal:'), 'yellow crystals:', 'Yellow Crystal:'), 'Purple Crystals:', 'Purple Crystal:'), 'Purple crystals:', 'Purple Crystal:'), 'purple crystals:', 'Purple Crystal:'), 'White Crystals:', 'White Crystal:'), 'White crystals:', 'White Crystal:'), 'white crystals:', 'White Crystal:'), 'red crystal:', 'Red Crystal:'), 'Damaged Sword, Knight''s:', 'Damaged Sword, Knight:')
WHERE data IS NOT NULL;

UPDATE content_rows SET data = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(data, 'Blue Crystals"', 'Blue Crystal"'), 'Blue crystals"', 'Blue Crystal"'), 'blue crystals"', 'Blue Crystal"'), 'Red Crystals"', 'Red Crystal"'), 'Red crystals"', 'Red Crystal"'), 'red crystals"', 'Red Crystal"'), 'Green Crystals"', 'Green Crystal"'), 'Green crystals"', 'Green Crystal"'), 'green crystals"', 'Green Crystal"'), 'Yellow Crystals"', 'Yellow Crystal"'), 'Yellow crystals"', 'Yellow Crystal"'), 'yellow crystals"', 'Yellow Crystal"'), 'Purple Crystals"', 'Purple Crystal"'), 'Purple crystals"', 'Purple Crystal"'), 'purple crystals"', 'Purple Crystal"'), 'White Crystals"', 'White Crystal"'), 'White crystals"', 'White Crystal"'), 'white crystals"', 'White Crystal"'), 'red crystal"', 'Red Crystal"'), 'Damaged Sword, Knight''s"', 'Damaged Sword, Knight"'), 'Blue Crystals:', 'Blue Crystal:'), 'Blue crystals:', 'Blue Crystal:'), 'blue crystals:', 'Blue Crystal:'), 'Red Crystals:', 'Red Crystal:'), 'Red crystals:', 'Red Crystal:'), 'red crystals:', 'Red Crystal:'), 'Green Crystals:', 'Green Crystal:'), 'Green crystals:', 'Green Crystal:'), 'green crystals:', 'Green Crystal:'), 'Yellow Crystals:', 'Yellow Crystal:'), 'Yellow crystals:', 'Yellow Crystal:'), 'yellow crystals:', 'Yellow Crystal:'), 'Purple Crystals:', 'Purple Crystal:'), 'Purple crystals:', 'Purple Crystal:'), 'purple crystals:', 'Purple Crystal:'), 'White Crystals:', 'White Crystal:'), 'White crystals:', 'White Crystal:'), 'white crystals:', 'White Crystal:'), 'red crystal:', 'Red Crystal:'), 'Damaged Sword, Knight''s:', 'Damaged Sword, Knight:')
WHERE data IS NOT NULL AND NOT (dataset = 'items' AND part = 'items');

UPDATE content_draft SET data = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(data, 'Blue Crystals"', 'Blue Crystal"'), 'Blue crystals"', 'Blue Crystal"'), 'blue crystals"', 'Blue Crystal"'), 'Red Crystals"', 'Red Crystal"'), 'Red crystals"', 'Red Crystal"'), 'red crystals"', 'Red Crystal"'), 'Green Crystals"', 'Green Crystal"'), 'Green crystals"', 'Green Crystal"'), 'green crystals"', 'Green Crystal"'), 'Yellow Crystals"', 'Yellow Crystal"'), 'Yellow crystals"', 'Yellow Crystal"'), 'yellow crystals"', 'Yellow Crystal"'), 'Purple Crystals"', 'Purple Crystal"'), 'Purple crystals"', 'Purple Crystal"'), 'purple crystals"', 'Purple Crystal"'), 'White Crystals"', 'White Crystal"'), 'White crystals"', 'White Crystal"'), 'white crystals"', 'White Crystal"'), 'red crystal"', 'Red Crystal"'), 'Damaged Sword, Knight''s"', 'Damaged Sword, Knight"'), 'Blue Crystals:', 'Blue Crystal:'), 'Blue crystals:', 'Blue Crystal:'), 'blue crystals:', 'Blue Crystal:'), 'Red Crystals:', 'Red Crystal:'), 'Red crystals:', 'Red Crystal:'), 'red crystals:', 'Red Crystal:'), 'Green Crystals:', 'Green Crystal:'), 'Green crystals:', 'Green Crystal:'), 'green crystals:', 'Green Crystal:'), 'Yellow Crystals:', 'Yellow Crystal:'), 'Yellow crystals:', 'Yellow Crystal:'), 'yellow crystals:', 'Yellow Crystal:'), 'Purple Crystals:', 'Purple Crystal:'), 'Purple crystals:', 'Purple Crystal:'), 'purple crystals:', 'Purple Crystal:'), 'White Crystals:', 'White Crystal:'), 'White crystals:', 'White Crystal:'), 'white crystals:', 'White Crystal:'), 'red crystal:', 'Red Crystal:'), 'Damaged Sword, Knight''s:', 'Damaged Sword, Knight:')
WHERE data IS NOT NULL AND NOT (dataset = 'items' AND part = 'items');

UPDATE content_draft_actions SET action = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(action, 'Blue Crystals"', 'Blue Crystal"'), 'Blue crystals"', 'Blue Crystal"'), 'blue crystals"', 'Blue Crystal"'), 'Red Crystals"', 'Red Crystal"'), 'Red crystals"', 'Red Crystal"'), 'red crystals"', 'Red Crystal"'), 'Green Crystals"', 'Green Crystal"'), 'Green crystals"', 'Green Crystal"'), 'green crystals"', 'Green Crystal"'), 'Yellow Crystals"', 'Yellow Crystal"'), 'Yellow crystals"', 'Yellow Crystal"'), 'yellow crystals"', 'Yellow Crystal"'), 'Purple Crystals"', 'Purple Crystal"'), 'Purple crystals"', 'Purple Crystal"'), 'purple crystals"', 'Purple Crystal"'), 'White Crystals"', 'White Crystal"'), 'White crystals"', 'White Crystal"'), 'white crystals"', 'White Crystal"'), 'red crystal"', 'Red Crystal"'), 'Damaged Sword, Knight''s"', 'Damaged Sword, Knight"'), 'Blue Crystals:', 'Blue Crystal:'), 'Blue crystals:', 'Blue Crystal:'), 'blue crystals:', 'Blue Crystal:'), 'Red Crystals:', 'Red Crystal:'), 'Red crystals:', 'Red Crystal:'), 'red crystals:', 'Red Crystal:'), 'Green Crystals:', 'Green Crystal:'), 'Green crystals:', 'Green Crystal:'), 'green crystals:', 'Green Crystal:'), 'Yellow Crystals:', 'Yellow Crystal:'), 'Yellow crystals:', 'Yellow Crystal:'), 'yellow crystals:', 'Yellow Crystal:'), 'Purple Crystals:', 'Purple Crystal:'), 'Purple crystals:', 'Purple Crystal:'), 'purple crystals:', 'Purple Crystal:'), 'White Crystals:', 'White Crystal:'), 'White crystals:', 'White Crystal:'), 'white crystals:', 'White Crystal:'), 'red crystal:', 'Red Crystal:'), 'Damaged Sword, Knight''s:', 'Damaged Sword, Knight:')
WHERE action IS NOT NULL;
