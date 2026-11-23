-- Spells by effect (#37 stage 4). The engine gave a spell its school, its power and (for Create
-- Food) its food from the 1.6 spell its `effect` names; content now gives them on the spell row
-- (`school`, `power`, `creates`) and the power tables in spells.json `power`, a section every
-- pack must supply. A spell row made before the upgrade (an imported pack's, an operator's, the
-- draft's, and the rows the publish log keeps for undo) gets the fields of the Classic spell its
-- effect names, where it has none, so it plays as it did; an imported pack gets Classic's power
-- tables. Running it again changes nothing.
CREATE TEMP TABLE classic_spells_61 (effect TEXT PRIMARY KEY, fields TEXT NOT NULL);
INSERT INTO classic_spells_61 (effect, fields) VALUES
  ('smoke bomb', '{"school":{"skill":"MartialArts","line":"You have advanced in the art of Martial Arts!","cap":100},"power":"MartialArts"}'),
  ('minor heal', '{"school":{"skill":"Blessing","line":"You have advanced in the art of blessing!"},"power":"Blessing"}'),
  ('morph', '{"school":{"skill":"Illusion","line":"You have advanced in the art of illusion!"},"power":"Illusion"}'),
  ('stone skin', '{"school":{"skill":"Earth","line":"You have advanced in the art of Earth!"},"power":"Earth"}'),
  ('crush', '{"school":{"skill":"Earth","line":"You have advanced in the art of Earth!"},"power":"Earth"}'),
  ('whirlwind', '{"school":{"skill":"wind","line":"You have advanced in the art of Wind!"},"power":"Wind"}'),
  ('meteor', '{"school":{"skill":"Wrath","line":"You have advanced in the art of Wrath!"},"power":"Wrath"}'),
  ('identify', '{}'),
  ('portal', '{}'),
  ('fireball', '{"school":{"skill":"fire","line":"You have advanced in the art of Fire!"},"power":"Fire"}'),
  ('summon creature', '{"school":{"skill":"Sorcery","line":"You have advanced in the art of Sorcery!"}}'),
  ('holy shield', '{"school":{"skill":"Blessing","line":"You have advanced in the art of Blessing!"}}'),
  ('wind wave', '{"school":{"skill":"wind","line":"You have advanced in the art of Wind!"},"power":"Wind"}'),
  ('bolt', '{"school":{"skill":"Wrath","line":"You have advanced in the art of Wrath!"},"power":"Wrath"}'),
  ('firebolt', '{"school":{"skill":"fire","line":"You have advanced in the art of Fire!"},"power":"Fire"}'),
  ('poison dart', '{}'),
  ('weaken', '{"power":"BlackArts"}'),
  ('bless', '{"power":"Blessing"}'),
  ('firesword', '{"school":{"skill":"fire","line":"You have advanced in the art of Fire!"},"power":"Fire"}'),
  ('major heal', '{"school":{"skill":"Blessing","line":"You have advanced in the art of blessing!"},"power":"Blessing"}'),
  ('replenish', '{"school":{"skill":"Blessing","line":"You have advanced in the art of blessing!"}}'),
  ('splash', '{"school":{"skill":"Water","line":"You have advanced in the art of Water!"},"power":"Water"}'),
  ('nature shift', '{}'),
  ('holy weapon', '{}'),
  ('illusionary spikes', '{"school":{"skill":"Illusion","line":"You have advanced in the art of illusion!"},"power":"Illusion"}'),
  ('argon''s fist', '{}'),
  ('inxition', '{}'),
  ('magic shield', '{"school":{"skill":"Wrath","line":"You have advanced in the art of Wrath!"},"power":"Wrath"}'),
  ('create food', '{"creates":[{"item":"Apple","article":"an"},{"item":"Pie"},{"item":"Corn"},{"item":"Fish"},{"item":"Ale"}]}'),
  ('dispel illusions', '{"school":{"skill":"Wizardry","line":"You have advanced in the art of Wizardry!"}}'),
  ('hold', '{"school":{"skill":"BlackArts","line":"You have advanced in the Black Arts!"},"power":"BlackArts"}'),
  ('raise dead', '{"school":{"skill":"BlackArts","line":"You have advanced in the Black Arts!"},"power":"BlackArts"}'),
  ('web', '{"school":{"skill":"Wizardry","line":"You have advanced in the art of Wizardry!"}}'),
  ('diminish hunger', '{"school":{"skill":"Blessing","line":"You have advanced in the art of blessing!"},"power":"Blessing"}'),
  ('radar', '{"school":{"skill":"Wrath","line":"You have advanced in the art of Wrath!"},"power":"Wrath"}'),
  ('haste', '{"power":"Blessing"}');

-- The base power read the skill bound as Magery (bindings.json `skills.magery`), and none when
-- none was bound: an older pack's base rows read its own binding, and an operator who bound
-- Magery to another skill, or unbound it, gets a power section that does the same.
UPDATE content_packs
SET data = json_set(data, '$.data.spells.power',
  json(coalesce(json_extract(data, '$.data.spells.power'), json_set('{"base":[{"when":["Magery > 10"],"op":"add","value":1},{"when":["Magery > 20"],"op":"add","value":1},{"when":["Magery > 30"],"op":"add","value":1},{"when":["Magery > 40"],"op":"add","value":1},{"when":["Magery > 50"],"op":"add","value":1},{"when":["Magery > 60"],"op":"add","value":1},{"when":["Magery > 70"],"op":"add","value":1},{"when":["Magery > 80"],"op":"add","value":1},{"when":["Magery > 90"],"op":"add","value":1}],"tables":{"Blessing":{"tiers":[{"when":["Blessing > 0"],"op":"add","value":2},{"when":["Blessing > 10"],"op":"add","value":1},{"when":["Blessing > 20"],"op":"add","value":1},{"when":["Blessing > 30"],"op":"add","value":1},{"when":["Blessing > 50"],"op":"add","value":1},{"when":["Blessing > 70"],"op":"add","value":1},{"when":["Blessing > 80"],"op":"add","value":1},{"when":["Blessing > 90"],"op":"add","value":1},{"when":["Blessing > 97"],"op":"add","value":1}]},"Wrath":{"tiers":[{"when":["Wrath > 0"],"op":"add","value":2},{"when":["Wrath > 10"],"op":"add","value":1},{"when":["Wrath > 20"],"op":"add","value":1},{"when":["Wrath > 30"],"op":"add","value":1},{"when":["Wrath > 50"],"op":"add","value":1},{"when":["Wrath > 70"],"op":"add","value":1},{"when":["Wrath > 80"],"op":"add","value":1},{"when":["Wrath > 90"],"op":"add","value":1},{"when":["Wrath > 97"],"op":"add","value":1}]},"Illusion":{"tiers":[{"when":["Illusion > 0"],"op":"add","value":2},{"when":["Illusion > 10"],"op":"add","value":1},{"when":["Illusion > 20"],"op":"add","value":1},{"when":["Illusion > 30"],"op":"add","value":1},{"when":["Illusion > 50"],"op":"add","value":1},{"when":["Illusion > 70"],"op":"add","value":1},{"when":["Illusion > 80"],"op":"add","value":1},{"when":["Illusion > 90"],"op":"add","value":1},{"when":["Illusion > 97"],"op":"add","value":1}]},"Water":{"tiers":[{"when":["Water > 0"],"op":"add","value":2},{"when":["Water > 10"],"op":"add","value":1},{"when":["Water > 20"],"op":"add","value":1},{"when":["Water > 30"],"op":"add","value":1},{"when":["Water > 50"],"op":"add","value":1},{"when":["Water > 70"],"op":"add","value":1},{"when":["Water > 80"],"op":"add","value":2},{"when":["Water > 97"],"op":"add","value":4}]},"Earth":{"tiers":[{"when":["Earth > 0"],"op":"add","value":2},{"when":["Earth > 10"],"op":"add","value":1},{"when":["Earth > 20"],"op":"add","value":1},{"when":["Earth > 30"],"op":"add","value":1},{"when":["Earth > 50"],"op":"add","value":1},{"when":["Earth > 70"],"op":"add","value":1},{"when":["Earth > 80"],"op":"add","value":2},{"when":["Earth > 97"],"op":"add","value":4}]},"Fire":{"tiers":[{"when":["fire > 0"],"op":"add","value":2},{"when":["fire > 10"],"op":"add","value":1},{"when":["fire > 20"],"op":"add","value":1},{"when":["fire > 30"],"op":"add","value":1},{"when":["fire > 50"],"op":"add","value":1},{"when":["fire > 70"],"op":"add","value":1},{"when":["fire > 80"],"op":"add","value":2},{"when":["fire > 97"],"op":"add","value":4}]},"Wind":{"tiers":[{"when":["wind > 0"],"op":"add","value":2},{"when":["wind > 10"],"op":"add","value":1},{"when":["wind > 20"],"op":"add","value":1},{"when":["wind > 30"],"op":"add","value":1},{"when":["wind > 50"],"op":"add","value":1},{"when":["wind > 70"],"op":"add","value":1},{"when":["wind > 80"],"op":"add","value":2},{"when":["wind > 97"],"op":"add","value":4}]},"BlackArts":{"tiers":[{"when":["BlackArts > 10"],"op":"add","value":1},{"when":["BlackArts > 20"],"op":"add","value":1},{"when":["BlackArts > 30"],"op":"add","value":1},{"when":["BlackArts > 70"],"op":"add","value":1},{"when":["BlackArts > 90"],"op":"add","value":1}],"gear":"blackArts"},"MartialArts":{"tiers":[{"when":null,"op":"set","value":1},{"when":["MartialArts < 101"],"op":"set","value":500},{"when":["MartialArts < 90"],"op":"set","value":350},{"when":["MartialArts < 80"],"op":"set","value":200},{"when":["MartialArts < 70"],"op":"set","value":100},{"when":["MartialArts < 60"],"op":"set","value":70},{"when":["MartialArts < 50"],"op":"set","value":60},{"when":["MartialArts < 40"],"op":"set","value":55},{"when":["MartialArts < 30"],"op":"set","value":45},{"when":["MartialArts < 20"],"op":"set","value":35},{"when":["MartialArts < 10"],"op":"set","value":25}],"gear":"martialArts"}}}', '$.base',
    json(CASE
      WHEN json_type(data, '$.data.bindings.skills') IS NULL THEN '[{"when":["Magery > 10"],"op":"add","value":1},{"when":["Magery > 20"],"op":"add","value":1},{"when":["Magery > 30"],"op":"add","value":1},{"when":["Magery > 40"],"op":"add","value":1},{"when":["Magery > 50"],"op":"add","value":1},{"when":["Magery > 60"],"op":"add","value":1},{"when":["Magery > 70"],"op":"add","value":1},{"when":["Magery > 80"],"op":"add","value":1},{"when":["Magery > 90"],"op":"add","value":1}]'
      WHEN json_type(data, '$.data.bindings.skills.magery') = 'text'
        THEN replace('[{"when":["Magery > 10"],"op":"add","value":1},{"when":["Magery > 20"],"op":"add","value":1},{"when":["Magery > 30"],"op":"add","value":1},{"when":["Magery > 40"],"op":"add","value":1},{"when":["Magery > 50"],"op":"add","value":1},{"when":["Magery > 60"],"op":"add","value":1},{"when":["Magery > 70"],"op":"add","value":1},{"when":["Magery > 80"],"op":"add","value":1},{"when":["Magery > 90"],"op":"add","value":1}]', '"Magery >', '"' || json_extract(data, '$.data.bindings.skills.magery') || ' >')
      ELSE '[]'
    END)))))
WHERE source = 'imported' AND json_type(data, '$.data.spells') = 'object';
INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at)
SELECT 'spells', 'power', '', 'set',
  json_set('{"base":[{"when":["Magery > 10"],"op":"add","value":1},{"when":["Magery > 20"],"op":"add","value":1},{"when":["Magery > 30"],"op":"add","value":1},{"when":["Magery > 40"],"op":"add","value":1},{"when":["Magery > 50"],"op":"add","value":1},{"when":["Magery > 60"],"op":"add","value":1},{"when":["Magery > 70"],"op":"add","value":1},{"when":["Magery > 80"],"op":"add","value":1},{"when":["Magery > 90"],"op":"add","value":1}],"tables":{"Blessing":{"tiers":[{"when":["Blessing > 0"],"op":"add","value":2},{"when":["Blessing > 10"],"op":"add","value":1},{"when":["Blessing > 20"],"op":"add","value":1},{"when":["Blessing > 30"],"op":"add","value":1},{"when":["Blessing > 50"],"op":"add","value":1},{"when":["Blessing > 70"],"op":"add","value":1},{"when":["Blessing > 80"],"op":"add","value":1},{"when":["Blessing > 90"],"op":"add","value":1},{"when":["Blessing > 97"],"op":"add","value":1}]},"Wrath":{"tiers":[{"when":["Wrath > 0"],"op":"add","value":2},{"when":["Wrath > 10"],"op":"add","value":1},{"when":["Wrath > 20"],"op":"add","value":1},{"when":["Wrath > 30"],"op":"add","value":1},{"when":["Wrath > 50"],"op":"add","value":1},{"when":["Wrath > 70"],"op":"add","value":1},{"when":["Wrath > 80"],"op":"add","value":1},{"when":["Wrath > 90"],"op":"add","value":1},{"when":["Wrath > 97"],"op":"add","value":1}]},"Illusion":{"tiers":[{"when":["Illusion > 0"],"op":"add","value":2},{"when":["Illusion > 10"],"op":"add","value":1},{"when":["Illusion > 20"],"op":"add","value":1},{"when":["Illusion > 30"],"op":"add","value":1},{"when":["Illusion > 50"],"op":"add","value":1},{"when":["Illusion > 70"],"op":"add","value":1},{"when":["Illusion > 80"],"op":"add","value":1},{"when":["Illusion > 90"],"op":"add","value":1},{"when":["Illusion > 97"],"op":"add","value":1}]},"Water":{"tiers":[{"when":["Water > 0"],"op":"add","value":2},{"when":["Water > 10"],"op":"add","value":1},{"when":["Water > 20"],"op":"add","value":1},{"when":["Water > 30"],"op":"add","value":1},{"when":["Water > 50"],"op":"add","value":1},{"when":["Water > 70"],"op":"add","value":1},{"when":["Water > 80"],"op":"add","value":2},{"when":["Water > 97"],"op":"add","value":4}]},"Earth":{"tiers":[{"when":["Earth > 0"],"op":"add","value":2},{"when":["Earth > 10"],"op":"add","value":1},{"when":["Earth > 20"],"op":"add","value":1},{"when":["Earth > 30"],"op":"add","value":1},{"when":["Earth > 50"],"op":"add","value":1},{"when":["Earth > 70"],"op":"add","value":1},{"when":["Earth > 80"],"op":"add","value":2},{"when":["Earth > 97"],"op":"add","value":4}]},"Fire":{"tiers":[{"when":["fire > 0"],"op":"add","value":2},{"when":["fire > 10"],"op":"add","value":1},{"when":["fire > 20"],"op":"add","value":1},{"when":["fire > 30"],"op":"add","value":1},{"when":["fire > 50"],"op":"add","value":1},{"when":["fire > 70"],"op":"add","value":1},{"when":["fire > 80"],"op":"add","value":2},{"when":["fire > 97"],"op":"add","value":4}]},"Wind":{"tiers":[{"when":["wind > 0"],"op":"add","value":2},{"when":["wind > 10"],"op":"add","value":1},{"when":["wind > 20"],"op":"add","value":1},{"when":["wind > 30"],"op":"add","value":1},{"when":["wind > 50"],"op":"add","value":1},{"when":["wind > 70"],"op":"add","value":1},{"when":["wind > 80"],"op":"add","value":2},{"when":["wind > 97"],"op":"add","value":4}]},"BlackArts":{"tiers":[{"when":["BlackArts > 10"],"op":"add","value":1},{"when":["BlackArts > 20"],"op":"add","value":1},{"when":["BlackArts > 30"],"op":"add","value":1},{"when":["BlackArts > 70"],"op":"add","value":1},{"when":["BlackArts > 90"],"op":"add","value":1}],"gear":"blackArts"},"MartialArts":{"tiers":[{"when":null,"op":"set","value":1},{"when":["MartialArts < 101"],"op":"set","value":500},{"when":["MartialArts < 90"],"op":"set","value":350},{"when":["MartialArts < 80"],"op":"set","value":200},{"when":["MartialArts < 70"],"op":"set","value":100},{"when":["MartialArts < 60"],"op":"set","value":70},{"when":["MartialArts < 50"],"op":"set","value":60},{"when":["MartialArts < 40"],"op":"set","value":55},{"when":["MartialArts < 30"],"op":"set","value":45},{"when":["MartialArts < 20"],"op":"set","value":35},{"when":["MartialArts < 10"],"op":"set","value":25}],"gear":"martialArts"}}}', '$.base', json(CASE
    WHEN json_type(b.data, '$.magery') = 'text'
      THEN replace('[{"when":["Magery > 10"],"op":"add","value":1},{"when":["Magery > 20"],"op":"add","value":1},{"when":["Magery > 30"],"op":"add","value":1},{"when":["Magery > 40"],"op":"add","value":1},{"when":["Magery > 50"],"op":"add","value":1},{"when":["Magery > 60"],"op":"add","value":1},{"when":["Magery > 70"],"op":"add","value":1},{"when":["Magery > 80"],"op":"add","value":1},{"when":["Magery > 90"],"op":"add","value":1}]', '"Magery >', '"' || json_extract(b.data, '$.magery') || ' >')
    ELSE '[]'
  END)),
  '19b7ab307f9b5f9a', '{"base":[{"when":["Magery > 10"],"op":"add","value":1},{"when":["Magery > 20"],"op":"add","value":1},{"when":["Magery > 30"],"op":"add","value":1},{"when":["Magery > 40"],"op":"add","value":1},{"when":["Magery > 50"],"op":"add","value":1},{"when":["Magery > 60"],"op":"add","value":1},{"when":["Magery > 70"],"op":"add","value":1},{"when":["Magery > 80"],"op":"add","value":1},{"when":["Magery > 90"],"op":"add","value":1}],"tables":{"Blessing":{"tiers":[{"when":["Blessing > 0"],"op":"add","value":2},{"when":["Blessing > 10"],"op":"add","value":1},{"when":["Blessing > 20"],"op":"add","value":1},{"when":["Blessing > 30"],"op":"add","value":1},{"when":["Blessing > 50"],"op":"add","value":1},{"when":["Blessing > 70"],"op":"add","value":1},{"when":["Blessing > 80"],"op":"add","value":1},{"when":["Blessing > 90"],"op":"add","value":1},{"when":["Blessing > 97"],"op":"add","value":1}]},"Wrath":{"tiers":[{"when":["Wrath > 0"],"op":"add","value":2},{"when":["Wrath > 10"],"op":"add","value":1},{"when":["Wrath > 20"],"op":"add","value":1},{"when":["Wrath > 30"],"op":"add","value":1},{"when":["Wrath > 50"],"op":"add","value":1},{"when":["Wrath > 70"],"op":"add","value":1},{"when":["Wrath > 80"],"op":"add","value":1},{"when":["Wrath > 90"],"op":"add","value":1},{"when":["Wrath > 97"],"op":"add","value":1}]},"Illusion":{"tiers":[{"when":["Illusion > 0"],"op":"add","value":2},{"when":["Illusion > 10"],"op":"add","value":1},{"when":["Illusion > 20"],"op":"add","value":1},{"when":["Illusion > 30"],"op":"add","value":1},{"when":["Illusion > 50"],"op":"add","value":1},{"when":["Illusion > 70"],"op":"add","value":1},{"when":["Illusion > 80"],"op":"add","value":1},{"when":["Illusion > 90"],"op":"add","value":1},{"when":["Illusion > 97"],"op":"add","value":1}]},"Water":{"tiers":[{"when":["Water > 0"],"op":"add","value":2},{"when":["Water > 10"],"op":"add","value":1},{"when":["Water > 20"],"op":"add","value":1},{"when":["Water > 30"],"op":"add","value":1},{"when":["Water > 50"],"op":"add","value":1},{"when":["Water > 70"],"op":"add","value":1},{"when":["Water > 80"],"op":"add","value":2},{"when":["Water > 97"],"op":"add","value":4}]},"Earth":{"tiers":[{"when":["Earth > 0"],"op":"add","value":2},{"when":["Earth > 10"],"op":"add","value":1},{"when":["Earth > 20"],"op":"add","value":1},{"when":["Earth > 30"],"op":"add","value":1},{"when":["Earth > 50"],"op":"add","value":1},{"when":["Earth > 70"],"op":"add","value":1},{"when":["Earth > 80"],"op":"add","value":2},{"when":["Earth > 97"],"op":"add","value":4}]},"Fire":{"tiers":[{"when":["fire > 0"],"op":"add","value":2},{"when":["fire > 10"],"op":"add","value":1},{"when":["fire > 20"],"op":"add","value":1},{"when":["fire > 30"],"op":"add","value":1},{"when":["fire > 50"],"op":"add","value":1},{"when":["fire > 70"],"op":"add","value":1},{"when":["fire > 80"],"op":"add","value":2},{"when":["fire > 97"],"op":"add","value":4}]},"Wind":{"tiers":[{"when":["wind > 0"],"op":"add","value":2},{"when":["wind > 10"],"op":"add","value":1},{"when":["wind > 20"],"op":"add","value":1},{"when":["wind > 30"],"op":"add","value":1},{"when":["wind > 50"],"op":"add","value":1},{"when":["wind > 70"],"op":"add","value":1},{"when":["wind > 80"],"op":"add","value":2},{"when":["wind > 97"],"op":"add","value":4}]},"BlackArts":{"tiers":[{"when":["BlackArts > 10"],"op":"add","value":1},{"when":["BlackArts > 20"],"op":"add","value":1},{"when":["BlackArts > 30"],"op":"add","value":1},{"when":["BlackArts > 70"],"op":"add","value":1},{"when":["BlackArts > 90"],"op":"add","value":1}],"gear":"blackArts"},"MartialArts":{"tiers":[{"when":null,"op":"set","value":1},{"when":["MartialArts < 101"],"op":"set","value":500},{"when":["MartialArts < 90"],"op":"set","value":350},{"when":["MartialArts < 80"],"op":"set","value":200},{"when":["MartialArts < 70"],"op":"set","value":100},{"when":["MartialArts < 60"],"op":"set","value":70},{"when":["MartialArts < 50"],"op":"set","value":60},{"when":["MartialArts < 40"],"op":"set","value":55},{"when":["MartialArts < 30"],"op":"set","value":45},{"when":["MartialArts < 20"],"op":"set","value":35},{"when":["MartialArts < 10"],"op":"set","value":25}],"gear":"martialArts"}}}',
  (SELECT coalesce(max(seq), 0) + 1 FROM content_rows), b.updated_by, b.updated_at
FROM content_rows b
WHERE b.dataset = 'bindings' AND b.part = 'skills' AND b.op = 'set' AND json_type(b.data) = 'object'
  AND json_extract(b.data, '$.magery') IS NOT 'Magery'
  AND NOT EXISTS (SELECT 1 FROM content_rows WHERE dataset = 'spells' AND part = 'power');
UPDATE content_packs
SET data = json_set(data, '$.data.spells.spells', (
  SELECT json_group_array(json(json_patch(s.value, (SELECT json_group_object(f.key, CASE WHEN f.type IN ('object', 'array') THEN json(f.value) ELSE f.value END)
    FROM classic_spells_61 cs, json_each(cs.fields) f
    WHERE cs.effect = lower(json_extract(s.value, '$.effect')) AND json_type(s.value, '$.' || f.key) IS NULL))))
  FROM (SELECT key, value FROM json_each(content_packs.data, '$.data.spells.spells') ORDER BY key) s
))
WHERE source = 'imported' AND json_type(data, '$.data.spells.spells') = 'array';

UPDATE content_rows
SET data = json_patch(data, (SELECT json_group_object(f.key, CASE WHEN f.type IN ('object', 'array') THEN json(f.value) ELSE f.value END)
    FROM classic_spells_61 cs, json_each(cs.fields) f
    WHERE cs.effect = lower(json_extract(data, '$.effect')) AND json_type(data, '$.' || f.key) IS NULL))
WHERE dataset = 'spells' AND part = 'spells' AND op = 'set' AND json_type(data) = 'object';
UPDATE content_draft
SET data = json_patch(data, (SELECT json_group_object(f.key, CASE WHEN f.type IN ('object', 'array') THEN json(f.value) ELSE f.value END)
    FROM classic_spells_61 cs, json_each(cs.fields) f
    WHERE cs.effect = lower(json_extract(data, '$.effect')) AND json_type(data, '$.' || f.key) IS NULL))
WHERE dataset = 'spells' AND part = 'spells' AND op = 'set' AND json_type(data) = 'object';

UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'spells' AND json_extract(c.value, '$.part') = 'spells'
      AND json_type(c.value, '$.before.data') = 'object'
    THEN json_set(c.value, '$.before.data', json(json_patch(json_extract(c.value, '$.before.data'), (SELECT json_group_object(f.key, CASE WHEN f.type IN ('object', 'array') THEN json(f.value) ELSE f.value END)
    FROM classic_spells_61 cs, json_each(cs.fields) f
    WHERE cs.effect = lower(json_extract(json_extract(c.value, '$.before.data'), '$.effect')) AND json_type(json_extract(c.value, '$.before.data'), '$.' || f.key) IS NULL))))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'spells' AND json_extract(c.value, '$.part') = 'spells'
);
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'spells' AND json_extract(c.value, '$.part') = 'spells'
      AND json_type(c.value, '$.after.data') = 'object'
    THEN json_set(c.value, '$.after.data', json(json_patch(json_extract(c.value, '$.after.data'), (SELECT json_group_object(f.key, CASE WHEN f.type IN ('object', 'array') THEN json(f.value) ELSE f.value END)
    FROM classic_spells_61 cs, json_each(cs.fields) f
    WHERE cs.effect = lower(json_extract(json_extract(c.value, '$.after.data'), '$.effect')) AND json_type(json_extract(c.value, '$.after.data'), '$.' || f.key) IS NULL))))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'spells' AND json_extract(c.value, '$.part') = 'spells'
);

DROP TABLE classic_spells_61;
