-- Factions as content (#37 stage 4). A faction was a number, 1 Mage, 2 Warrior, 3 Adventurer, and
-- the engine knew each one's perks, member, Bio line and starting power; each faction is now a
-- content row (social.json `factions`) keyed by a name that characters and maps save: mage,
-- warrior, adventurer for Classic's three. Running the content part again changes nothing.

CREATE TEMP TABLE classic_factions_63 (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  member TEXT NOT NULL,
  start_power INTEGER NOT NULL,
  bio_text TEXT NOT NULL,
  bio TEXT NOT NULL,
  perks TEXT NOT NULL,
  row TEXT NOT NULL,
  row_hash TEXT NOT NULL
);
INSERT INTO classic_factions_63 (id, key, member, start_power, bio_text, bio, perks, row, row_hash) VALUES
  (1, 'mage', 'Mage Faction Member', 27, 'mages', 'Loyal to the Mages', '[{"kind":"spellPower","values":[0,1,2,3,4,5,6,7,8,9]},{"kind":"mageCap","values":[50,60,70,90,100,100,100,100,100,100]}]', '{"key":"mage","name":"Mage","leader":"Angela","head":"Mage''s Head","member":"Mage Faction Member","startPower":27,"bio":"Loyal to the Mages","perks":[{"kind":"spellPower","values":[0,1,2,3,4,5,6,7,8,9]},{"kind":"mageCap","values":[50,60,70,90,100,100,100,100,100,100]}],"joinHpMaxAbove":49,"joinCount":212000,"rejoinAdds":212000,"texts":{"join":"Angela says \"Welcome to the Mage faction.\"","weak":"Angela says \"You need more experience to join us.\"","rejoin":"Angela says \"I hope that you will be with us for years to come.\"","other":"Angela says \"We could use someone like you in our faction.\"","announce":"*** The Mage faction has become stronger thanks to {NAME}.","announceOther":"*** The Mage''s faction has become stronger thanks to {NAME}."},"exileHpMaxBelow":50,"exileText":"*** You have been exiled from the Mage faction due to your downfalls in battle.","loyalty":[{"count":20000,"text":"*** Angela requests you bring her the head of a rival faction member.","kick":false},{"count":10000,"text":"*** If you wish to continue to server the Mages, see Angela immediately.","kick":false},{"count":5000,"text":"*** You will soon be kicked out of the Mages if you do not bring the head of a rival faction member to Angela.","kick":false},{"count":1,"text":"*** You have been kicked out of the Mage faction due to lack of loyalty.","kick":true}]}', 'afebdf471188b7ef'),
  (2, 'warrior', 'Warrior Faction Member', 123, 'warriors', 'Loyal to the Warriors', '[{"kind":"melee","values":[0,1,2,3,4,5,6,7,8,9]},{"kind":"defence","values":[0,1,1,1,1,2,2,2,2,3]},{"kind":"skillCap","values":[55,60,70,80,90,100,100,100,100,100]}]', '{"key":"warrior","name":"Warrior","leader":"Trianus","head":"Warrior''s Head","member":"Warrior Faction Member","startPower":123,"bio":"Loyal to the Warriors","perks":[{"kind":"melee","values":[0,1,2,3,4,5,6,7,8,9]},{"kind":"defence","values":[0,1,1,1,1,2,2,2,2,3]},{"kind":"skillCap","values":[55,60,70,80,90,100,100,100,100,100]}],"joinHpMaxAbove":59,"joinCount":212000,"rejoinAdds":212000,"texts":{"join":"Trianus says \"Welcome to the Warrior''s faction.\"","weak":"Trianus says \"You need more experience to join us.\"","rejoin":"Trianus says \"You can stay longer with us for this display of courage.\"","other":"Trianus says \"It''s a shame you aren''t one of us.\"","announce":"*** The Warrior''s faction has become stronger thanks to {NAME}.","announceOther":"*** The Warrior''s faction has become stronger thanks to {NAME}."},"exileHpMaxBelow":60,"exileText":"*** You have been exiled from the Warrior''s faction due to your downfalls in battle.","loyalty":[{"count":20000,"text":"*** Trianus requests you bring him the head of a rival faction member.","kick":false},{"count":10000,"text":"*** If you wish to continue to server the Warriors, see Trianus immediately.","kick":false},{"count":5000,"text":"*** You will soon be kicked out of the Warriors if you do not bring the head of a rival faction member to Trianus.","kick":false},{"count":1,"text":"*** You have been kicked out of the Warrior faction due to lack of loyalty.","kick":true}]}', '2f97eab6a065d92b'),
  (3, 'adventurer', 'Adventurer Faction Member', 0, 'adventurers', 'Loyal to the Adventurers', '[{"kind":"defence","values":[0,1,1,1,1,1,1,2,2,2]},{"kind":"skillCap","values":[55,60,65,70,75,80,80,80,80,80]},{"kind":"regeneration","values":[5,10,15,20,25,30,35,40,45,50]},{"kind":"pvpParry","values":[4]},{"kind":"pvpBlock","values":[10]},{"kind":"monsterDodge","values":[10]}]', '{"key":"adventurer","name":"Adventurer","leader":"Corin","head":"Adventurer''s Head","member":"Adventurer Faction Member","startPower":0,"bio":"Loyal to the Adventurers","perks":[{"kind":"defence","values":[0,1,1,1,1,1,1,2,2,2]},{"kind":"skillCap","values":[55,60,65,70,75,80,80,80,80,80]},{"kind":"regeneration","values":[5,10,15,20,25,30,35,40,45,50]},{"kind":"pvpParry","values":[4]},{"kind":"pvpBlock","values":[10]},{"kind":"monsterDodge","values":[10]}],"joinHpMaxAbove":49,"joinCount":212000,"rejoinAdds":212000,"texts":{"join":"Corin says \"Welcome to the Adventurer''s faction.\"","weak":"Corin says \"You need more experience to join us.\"","rejoin":"Corin says \"I have added more time to your membership.\"","other":"Corin says \"You should see the light and join us.\"","announce":"*** The Adventurer''s faction has become stronger thanks to {NAME}.","announceOther":"*** The Adventurer''s faction has become stronger thanks to {NAME}."},"exileHpMaxBelow":40,"exileText":"*** You have been exiled from the Adventurer''s faction due to your downfalls in battle.","loyalty":[{"count":20000,"text":"*** Corin requests you bring him the head of a rival faction member.","kick":false},{"count":10000,"text":"*** If you wish to continue to server the Adventurers, see Corin immediately.","kick":false},{"count":5000,"text":"*** You will soon be kicked out of the Adventurers if you do not bring the head of a rival faction member to Corin.","kick":false},{"count":1,"text":"*** You have been kicked out of the Adventurer faction due to lack of loyalty.","kick":true}]}', 'fcd4827170fa4667');

-- A character's faction is saved by key; 0 (none) is NULL.
ALTER TABLE characters ADD COLUMN faction_key TEXT;
UPDATE characters SET faction_key = (SELECT key FROM classic_factions_63 WHERE id = characters.faction);
ALTER TABLE characters DROP COLUMN faction;
ALTER TABLE characters RENAME COLUMN faction_key TO faction;

-- The powers, by key. A faction with no saved power has its content's start power.
CREATE TABLE faction_power (
  faction TEXT PRIMARY KEY,
  power INTEGER NOT NULL
);
INSERT INTO faction_power (faction, power)
  SELECT 'mage', mage FROM faction_powers WHERE id = 1
  UNION ALL SELECT 'warrior', warrior FROM faction_powers WHERE id = 1
  UNION ALL SELECT 'adventurer', adventurer FROM faction_powers WHERE id = 1;
DROP TABLE faction_powers;

-- A map's faction spawn names its faction by key (1.6's W, M and A); anything else (1.6's X and O)
-- is none, ''.
UPDATE maps SET fct_spwn = CASE upper(fct_spwn)
  WHEN 'W' THEN 'warrior' WHEN 'M' THEN 'mage' WHEN 'A' THEN 'adventurer' ELSE '' END;

-- A house type's interior template carries the same flag, which a new interior copies.
UPDATE content_packs
SET data = json_set(data, '$.data.houses.types', (
  SELECT json_group_array(json(CASE WHEN json_type(s.value, '$.template.flags.fctSpwn') = 'text' AND upper(json_extract(s.value, '$.template.flags.fctSpwn')) IN ('W', 'M', 'A', 'X', 'O') THEN json_set(s.value, '$.template.flags.fctSpwn', CASE upper(coalesce(json_extract(s.value, '$.template.flags.fctSpwn'), ''))
  WHEN 'W' THEN 'warrior' WHEN 'M' THEN 'mage' WHEN 'A' THEN 'adventurer' ELSE '' END) ELSE s.value END))
  FROM (SELECT key, value FROM json_each(content_packs.data, '$.data.houses.types') ORDER BY key) s
))
WHERE source = 'imported' AND json_type(data, '$.data.houses.types') = 'array';
UPDATE content_rows SET data = json_set(data, '$.template.flags.fctSpwn', CASE upper(coalesce(json_extract(data, '$.template.flags.fctSpwn'), ''))
  WHEN 'W' THEN 'warrior' WHEN 'M' THEN 'mage' WHEN 'A' THEN 'adventurer' ELSE '' END)
WHERE dataset = 'houses' AND part = 'types' AND op = 'set' AND json_type(data) = 'object' AND json_type(data, '$.template.flags.fctSpwn') = 'text' AND upper(json_extract(data, '$.template.flags.fctSpwn')) IN ('W', 'M', 'A', 'X', 'O');
UPDATE content_draft SET data = json_set(data, '$.template.flags.fctSpwn', CASE upper(coalesce(json_extract(data, '$.template.flags.fctSpwn'), ''))
  WHEN 'W' THEN 'warrior' WHEN 'M' THEN 'mage' WHEN 'A' THEN 'adventurer' ELSE '' END)
WHERE dataset = 'houses' AND part = 'types' AND op = 'set' AND json_type(data) = 'object' AND json_type(data, '$.template.flags.fctSpwn') = 'text' AND upper(json_extract(data, '$.template.flags.fctSpwn')) IN ('W', 'M', 'A', 'X', 'O');
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'houses' AND json_extract(c.value, '$.part') = 'types'
    THEN json_set(c.value,
      '$.before', json(CASE WHEN json_type(json_extract(c.value, '$.before.data'), '$.template.flags.fctSpwn') = 'text' AND upper(json_extract(json_extract(c.value, '$.before.data'), '$.template.flags.fctSpwn')) IN ('W', 'M', 'A', 'X', 'O')
        THEN json_set(json_extract(c.value, '$.before'), '$.data', json(json_set(json_extract(c.value, '$.before.data'), '$.template.flags.fctSpwn', CASE upper(coalesce(json_extract(json_extract(c.value, '$.before.data'), '$.template.flags.fctSpwn'), ''))
  WHEN 'W' THEN 'warrior' WHEN 'M' THEN 'mage' WHEN 'A' THEN 'adventurer' ELSE '' END)))
        ELSE json_extract(c.value, '$.before') END),
      '$.after', json(CASE WHEN json_type(json_extract(c.value, '$.after.data'), '$.template.flags.fctSpwn') = 'text' AND upper(json_extract(json_extract(c.value, '$.after.data'), '$.template.flags.fctSpwn')) IN ('W', 'M', 'A', 'X', 'O')
        THEN json_set(json_extract(c.value, '$.after'), '$.data', json(json_set(json_extract(c.value, '$.after.data'), '$.template.flags.fctSpwn', CASE upper(coalesce(json_extract(json_extract(c.value, '$.after.data'), '$.template.flags.fctSpwn'), ''))
  WHEN 'W' THEN 'warrior' WHEN 'M' THEN 'mage' WHEN 'A' THEN 'adventurer' ELSE '' END)))
        ELSE json_extract(c.value, '$.after') END))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'houses' AND json_extract(c.value, '$.part') = 'types'
);

-- The character editor's log names a faction by key, so undoing an edit sets the same faction.
UPDATE character_edits
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.field') = 'faction'
    THEN json_set(c.value,
      '$.before', (SELECT key FROM classic_factions_63 WHERE id = json_extract(c.value, '$.before')),
      '$.after', (SELECT key FROM classic_factions_63 WHERE id = json_extract(c.value, '$.after')))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(character_edits.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(character_edits.changes) c
  WHERE json_extract(c.value, '$.field') = 'faction' AND json_type(c.value, '$.after') = 'integer'
);

-- The content: each faction row takes its key, member species, start power, Bio line (from the
-- Bio texts 'mages', 'warriors' and 'adventurers', which go) and Classic's perks; the faction rules
-- lose the power file and take the tiers, the perk defaults and the World Editor's boxes. For an
-- imported pack, the operator's rows, the draft and the rows the publish log keeps for undo.
UPDATE content_packs
SET data = json_set(data, '$.data.social.factions', (
  SELECT json_group_array(json(CASE WHEN json_type(s.value, '$.id') = 'integer'
    THEN (
    SELECT json_set(json_remove(s.value, '$.id'), '$.key', f.key, '$.member', f.member,
      '$.startPower', f.start_power,
      '$.bio', coalesce(json_extract(json_extract(content_packs.data, '$.data.social.bios'), '$.texts.' || f.bio_text || '.text'), f.bio),
      '$.perks', json(f.perks))
    FROM classic_factions_63 f WHERE f.id = json_extract(s.value, '$.id')
  ) ELSE s.value END))
  FROM (SELECT key, value FROM json_each(content_packs.data, '$.data.social.factions') ORDER BY key) s
))
WHERE source = 'imported' AND json_type(data, '$.data.social.factions') = 'array';
UPDATE content_packs SET data = json_set(data, '$.data.social.factionRules', json(json_set(json_remove(json_extract(data, '$.data.social.factionRules'), '$.powers'),
    '$.tiers', json(coalesce(json_extract(json_extract(data, '$.data.social.factionRules'), '$.tiers'), '{"top":9,"below":[{"below":90,"tier":9},{"below":80,"tier":8},{"below":70,"tier":7},{"below":60,"tier":6},{"below":50,"tier":5},{"below":40,"tier":4},{"below":30,"tier":3},{"below":20,"tier":2},{"below":10,"tier":1},{"below":5,"tier":0}]}')),
    '$.perkDefaults', json(coalesce(json_extract(json_extract(data, '$.data.social.factionRules'), '$.perkDefaults'), '{"skillCap":50,"mageCap":30}')),
    '$.editorBoxes', json(coalesce(json_extract(json_extract(data, '$.data.social.factionRules'), '$.editorBoxes'), '["warrior","mage","adventurer"]')))))
WHERE source = 'imported' AND json_type(data, '$.data.social.factionRules') = 'object';
UPDATE content_packs SET data = json_set(data, '$.data.social.bios', json(json_remove(json_extract(data, '$.data.social.bios'), '$.texts.mages', '$.texts.warriors', '$.texts.adventurers')))
WHERE source = 'imported' AND json_type(data, '$.data.social.bios') = 'object';

UPDATE content_rows
SET data = CASE WHEN json_type(data) = 'object' AND json_type(data, '$.id') = 'integer' THEN (
    SELECT json_set(json_remove(data, '$.id'), '$.key', f.key, '$.member', f.member,
      '$.startPower', f.start_power,
      '$.bio', coalesce(json_extract((SELECT data FROM content_rows WHERE dataset = 'social' AND part = 'bios' AND op = 'set'), '$.texts.' || f.bio_text || '.text'), f.bio),
      '$.perks', json(f.perks))
    FROM classic_factions_63 f WHERE f.id = json_extract(data, '$.id')
  ) ELSE data END,
  row_key = coalesce((SELECT f.key FROM classic_factions_63 f WHERE CAST(f.id AS TEXT) = row_key), row_key)
WHERE dataset = 'social' AND part = 'factions';
UPDATE content_draft
SET data = CASE WHEN json_type(data) = 'object' AND json_type(data, '$.id') = 'integer'
    THEN (
    SELECT json_set(json_remove(data, '$.id'), '$.key', f.key, '$.member', f.member,
      '$.startPower', f.start_power,
      '$.bio', coalesce(json_extract(coalesce((SELECT data FROM content_draft WHERE dataset = 'social' AND part = 'bios' AND op = 'set'), (SELECT data FROM content_rows WHERE dataset = 'social' AND part = 'bios' AND op = 'set')), '$.texts.' || f.bio_text || '.text'), f.bio),
      '$.perks', json(f.perks))
    FROM classic_factions_63 f WHERE f.id = json_extract(data, '$.id')
  )
    ELSE data END,
  row_key = coalesce((SELECT f.key FROM classic_factions_63 f WHERE CAST(f.id AS TEXT) = row_key), row_key)
WHERE dataset = 'social' AND part = 'factions';
-- A Bio line an operator changed in the Bio texts alone (no change of that faction) becomes a
-- change of the faction's row, so it is not lost with the texts; the draft's the same, on top of
-- the published faction row.
INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at)
SELECT 'social', 'factions', f.key, 'set',
  json_set(f.row, '$.bio', json_extract(b.data, '$.texts.' || f.bio_text || '.text')),
  f.row_hash, f.row, (SELECT coalesce(max(seq), 0) FROM content_rows) + f.id, b.updated_by, b.updated_at
FROM classic_factions_63 f, content_rows b
WHERE b.dataset = 'social' AND b.part = 'bios' AND b.op = 'set' AND json_type(b.data) = 'object'
  AND json_type(b.data, '$.texts.' || f.bio_text || '.text') = 'text'
  AND json_extract(b.data, '$.texts.' || f.bio_text || '.text') IS NOT f.bio
  AND NOT EXISTS (
    SELECT 1 FROM content_rows r WHERE r.dataset = 'social' AND r.part = 'factions' AND lower(r.row_key) = f.key
  );
INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at)
SELECT 'social', 'factions', f.key, 'set',
  json_set(coalesce(
    (SELECT r.data FROM content_rows r
      WHERE r.dataset = 'social' AND r.part = 'factions' AND lower(r.row_key) = f.key AND r.op = 'set'),
    f.row), '$.bio', json_extract(b.data, '$.texts.' || f.bio_text || '.text')),
  b.author_account_id, b.author, b.updated_at
FROM classic_factions_63 f, content_draft b
WHERE b.dataset = 'social' AND b.part = 'bios' AND b.op = 'set' AND json_type(b.data) = 'object'
  AND json_type(b.data, '$.texts.' || f.bio_text || '.text') = 'text'
  AND json_extract(b.data, '$.texts.' || f.bio_text || '.text') IS NOT coalesce(
    (SELECT json_extract(r.data, '$.bio') FROM content_rows r
      WHERE r.dataset = 'social' AND r.part = 'factions' AND lower(r.row_key) = f.key AND r.op = 'set'),
    f.bio)
  AND NOT EXISTS (
    SELECT 1 FROM content_draft r WHERE r.dataset = 'social' AND r.part = 'factions' AND lower(r.row_key) = f.key
  );

UPDATE content_rows SET data = json_set(json_remove(data, '$.powers'),
    '$.tiers', json(coalesce(json_extract(data, '$.tiers'), '{"top":9,"below":[{"below":90,"tier":9},{"below":80,"tier":8},{"below":70,"tier":7},{"below":60,"tier":6},{"below":50,"tier":5},{"below":40,"tier":4},{"below":30,"tier":3},{"below":20,"tier":2},{"below":10,"tier":1},{"below":5,"tier":0}]}')),
    '$.perkDefaults', json(coalesce(json_extract(data, '$.perkDefaults'), '{"skillCap":50,"mageCap":30}')),
    '$.editorBoxes', json(coalesce(json_extract(data, '$.editorBoxes'), '["warrior","mage","adventurer"]')))
WHERE dataset = 'social' AND part = 'factionRules' AND op = 'set' AND json_type(data) = 'object';
UPDATE content_draft SET data = json_set(json_remove(data, '$.powers'),
    '$.tiers', json(coalesce(json_extract(data, '$.tiers'), '{"top":9,"below":[{"below":90,"tier":9},{"below":80,"tier":8},{"below":70,"tier":7},{"below":60,"tier":6},{"below":50,"tier":5},{"below":40,"tier":4},{"below":30,"tier":3},{"below":20,"tier":2},{"below":10,"tier":1},{"below":5,"tier":0}]}')),
    '$.perkDefaults', json(coalesce(json_extract(data, '$.perkDefaults'), '{"skillCap":50,"mageCap":30}')),
    '$.editorBoxes', json(coalesce(json_extract(data, '$.editorBoxes'), '["warrior","mage","adventurer"]')))
WHERE dataset = 'social' AND part = 'factionRules' AND op = 'set' AND json_type(data) = 'object';

UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'social' AND json_extract(c.value, '$.part') = 'factions'
    THEN json_set(c.value,
      '$.key', coalesce((SELECT f.key FROM classic_factions_63 f WHERE CAST(f.id AS TEXT) = json_extract(c.value, '$.key')), json_extract(c.value, '$.key')),
      '$.before', json(CASE WHEN json_type(c.value, '$.before.data') = 'object' AND json_type(json_extract(c.value, '$.before.data'), '$.id') = 'integer'
        THEN json_set(json_extract(c.value, '$.before'), '$.data', json((
    SELECT json_set(json_remove(json_extract(c.value, '$.before.data'), '$.id'), '$.key', f.key, '$.member', f.member,
      '$.startPower', f.start_power,
      '$.bio', coalesce(json_extract((SELECT data FROM content_rows WHERE dataset = 'social' AND part = 'bios' AND op = 'set'), '$.texts.' || f.bio_text || '.text'), f.bio),
      '$.perks', json(f.perks))
    FROM classic_factions_63 f WHERE f.id = json_extract(json_extract(c.value, '$.before.data'), '$.id')
  )))
        ELSE json_extract(c.value, '$.before') END),
      '$.after', json(CASE WHEN json_type(c.value, '$.after.data') = 'object' AND json_type(json_extract(c.value, '$.after.data'), '$.id') = 'integer'
        THEN json_set(json_extract(c.value, '$.after'), '$.data', json((
    SELECT json_set(json_remove(json_extract(c.value, '$.after.data'), '$.id'), '$.key', f.key, '$.member', f.member,
      '$.startPower', f.start_power,
      '$.bio', coalesce(json_extract((SELECT data FROM content_rows WHERE dataset = 'social' AND part = 'bios' AND op = 'set'), '$.texts.' || f.bio_text || '.text'), f.bio),
      '$.perks', json(f.perks))
    FROM classic_factions_63 f WHERE f.id = json_extract(json_extract(c.value, '$.after.data'), '$.id')
  )))
        ELSE json_extract(c.value, '$.after') END))
    WHEN json_extract(c.value, '$.dataset') = 'social' AND json_extract(c.value, '$.part') IN ('factionRules', 'bios')
    THEN json_set(c.value,
      '$.before', json(CASE WHEN json_type(c.value, '$.before.data') = 'object'
        THEN json_set(json_extract(c.value, '$.before'), '$.data', json(CASE json_extract(c.value, '$.part')
          WHEN 'bios' THEN json_remove(json_extract(c.value, '$.before.data'), '$.texts.mages', '$.texts.warriors', '$.texts.adventurers')
          ELSE json_set(json_remove(json_extract(c.value, '$.before.data'), '$.powers'),
    '$.tiers', json(coalesce(json_extract(json_extract(c.value, '$.before.data'), '$.tiers'), '{"top":9,"below":[{"below":90,"tier":9},{"below":80,"tier":8},{"below":70,"tier":7},{"below":60,"tier":6},{"below":50,"tier":5},{"below":40,"tier":4},{"below":30,"tier":3},{"below":20,"tier":2},{"below":10,"tier":1},{"below":5,"tier":0}]}')),
    '$.perkDefaults', json(coalesce(json_extract(json_extract(c.value, '$.before.data'), '$.perkDefaults'), '{"skillCap":50,"mageCap":30}')),
    '$.editorBoxes', json(coalesce(json_extract(json_extract(c.value, '$.before.data'), '$.editorBoxes'), '["warrior","mage","adventurer"]'))) END))
        ELSE json_extract(c.value, '$.before') END),
      '$.after', json(CASE WHEN json_type(c.value, '$.after.data') = 'object'
        THEN json_set(json_extract(c.value, '$.after'), '$.data', json(CASE json_extract(c.value, '$.part')
          WHEN 'bios' THEN json_remove(json_extract(c.value, '$.after.data'), '$.texts.mages', '$.texts.warriors', '$.texts.adventurers')
          ELSE json_set(json_remove(json_extract(c.value, '$.after.data'), '$.powers'),
    '$.tiers', json(coalesce(json_extract(json_extract(c.value, '$.after.data'), '$.tiers'), '{"top":9,"below":[{"below":90,"tier":9},{"below":80,"tier":8},{"below":70,"tier":7},{"below":60,"tier":6},{"below":50,"tier":5},{"below":40,"tier":4},{"below":30,"tier":3},{"below":20,"tier":2},{"below":10,"tier":1},{"below":5,"tier":0}]}')),
    '$.perkDefaults', json(coalesce(json_extract(json_extract(c.value, '$.after.data'), '$.perkDefaults'), '{"skillCap":50,"mageCap":30}')),
    '$.editorBoxes', json(coalesce(json_extract(json_extract(c.value, '$.after.data'), '$.editorBoxes'), '["warrior","mage","adventurer"]'))) END))
        ELSE json_extract(c.value, '$.after') END))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'social'
    AND json_extract(c.value, '$.part') IN ('factions', 'factionRules', 'bios')
);

-- The Bio texts lose the faction lines (now each faction's `bio`), after everything above read them.
UPDATE content_draft SET data = json_remove(data, '$.texts.mages', '$.texts.warriors', '$.texts.adventurers')
WHERE dataset = 'social' AND part = 'bios' AND op = 'set' AND json_type(data) = 'object';
UPDATE content_rows SET data = json_remove(data, '$.texts.mages', '$.texts.warriors', '$.texts.adventurers')
WHERE dataset = 'social' AND part = 'bios' AND op = 'set' AND json_type(data) = 'object';

DROP TABLE classic_factions_63;
