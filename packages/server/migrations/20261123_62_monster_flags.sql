-- Monster flags (#37 stage 4). The engine gave a species a mechanic by its body number (body 92
-- held players as a Web, 91 was grabbed as a Pig, 45 was healed by Firebolt…); content now gives
-- them as the species' `flags` in monsters.json. A species row made before the upgrade (an imported
-- pack's, an operator's, the draft's, and the rows the publish log keeps for undo) gets the flags
-- its body gave it, where it has none, so it plays as it did. Running it again changes nothing.
CREATE TEMP TABLE body_flags_62 (body INTEGER PRIMARY KEY, flags TEXT NOT NULL);
INSERT INTO body_flags_62 (body, flags) VALUES
  (36, '{"healedBy":["Splash"]}'),
  (90, '{"immobile":true,"unclickable":true,"dispellable":true}'),
  (45, '{"healedBy":["Firebolt"],"resists":["Fireball"]}'),
  (47, '{"healedBy":["Crush"]}'),
  (91, '{"unclickable":true,"grabbable":"Pig"}'),
  (61, '{"hurtByHealing":true}'),
  (92, '{"immobile":true,"unclickable":true,"trap":true}'),
  (99, '{"immobile":true,"unclickable":true,"shieldsInnocent":true}');

UPDATE content_packs
SET data = json_set(data, '$.data.monsters.monsters', (
  SELECT json_group_array(json(CASE
    WHEN json_type(s.value, '$.flags') IS NULL
      AND EXISTS (SELECT 1 FROM body_flags_62 b WHERE b.body = json_extract(s.value, '$.body'))
    THEN json_set(s.value, '$.flags', json((SELECT b.flags FROM body_flags_62 b WHERE b.body = json_extract(s.value, '$.body'))))
    ELSE s.value
  END))
  FROM (SELECT key, value FROM json_each(content_packs.data, '$.data.monsters.monsters') ORDER BY key) s
))
WHERE source = 'imported' AND json_type(data, '$.data.monsters.monsters') = 'array';

UPDATE content_rows
SET data = CASE
    WHEN json_type(data, '$.flags') IS NULL
      AND EXISTS (SELECT 1 FROM body_flags_62 b WHERE b.body = json_extract(data, '$.body'))
    THEN json_set(data, '$.flags', json((SELECT b.flags FROM body_flags_62 b WHERE b.body = json_extract(data, '$.body'))))
    ELSE data
  END
WHERE dataset = 'monsters' AND part = 'monsters' AND op = 'set' AND json_type(data) = 'object';
UPDATE content_draft
SET data = CASE
    WHEN json_type(data, '$.flags') IS NULL
      AND EXISTS (SELECT 1 FROM body_flags_62 b WHERE b.body = json_extract(data, '$.body'))
    THEN json_set(data, '$.flags', json((SELECT b.flags FROM body_flags_62 b WHERE b.body = json_extract(data, '$.body'))))
    ELSE data
  END
WHERE dataset = 'monsters' AND part = 'monsters' AND op = 'set' AND json_type(data) = 'object';

UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'monsters' AND json_extract(c.value, '$.part') = 'monsters'
      AND json_type(c.value, '$.before.data') = 'object'
    THEN json_set(c.value, '$.before.data', json(CASE
    WHEN json_type(json_extract(c.value, '$.before.data'), '$.flags') IS NULL
      AND EXISTS (SELECT 1 FROM body_flags_62 b WHERE b.body = json_extract(json_extract(c.value, '$.before.data'), '$.body'))
    THEN json_set(json_extract(c.value, '$.before.data'), '$.flags', json((SELECT b.flags FROM body_flags_62 b WHERE b.body = json_extract(json_extract(c.value, '$.before.data'), '$.body'))))
    ELSE json_extract(c.value, '$.before.data')
  END))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'monsters' AND json_extract(c.value, '$.part') = 'monsters'
);
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'monsters' AND json_extract(c.value, '$.part') = 'monsters'
      AND json_type(c.value, '$.after.data') = 'object'
    THEN json_set(c.value, '$.after.data', json(CASE
    WHEN json_type(json_extract(c.value, '$.after.data'), '$.flags') IS NULL
      AND EXISTS (SELECT 1 FROM body_flags_62 b WHERE b.body = json_extract(json_extract(c.value, '$.after.data'), '$.body'))
    THEN json_set(json_extract(c.value, '$.after.data'), '$.flags', json((SELECT b.flags FROM body_flags_62 b WHERE b.body = json_extract(json_extract(c.value, '$.after.data'), '$.body'))))
    ELSE json_extract(c.value, '$.after.data')
  END))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'monsters' AND json_extract(c.value, '$.part') = 'monsters'
);

DROP TABLE body_flags_62;
