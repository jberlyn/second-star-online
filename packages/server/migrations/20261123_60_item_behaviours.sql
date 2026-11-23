-- Item behaviours (#37 stage 3). 1.6 gave an item a behaviour by a word in its name ("Key" opened
-- doors, "bow" shot arrows, " Chest" opened as a chest); content now gives them, in item-rules.json
-- `behaviours`, a section every pack must supply. An imported pack was made when the engine read
-- the words itself, so it gets Classic's rows, which read them as the engine did then (with
-- Classic's two fixes: Bowmaster's Ring is no bow, and a Swordfish no sword for Firesword).
-- Running it again changes nothing.
UPDATE content_packs
SET data = json_set(data, '$.data."item-rules".behaviours',
  json(coalesce(json_extract(data, '$.data."item-rules".behaviours'), '[{"match":"contains","pattern":"Key","behaviour":"key"},{"match":"contains","pattern":"Book","behaviour":"book"},{"match":"exact","pattern":"Wooden Bow","behaviour":"bow"},{"match":"exact","pattern":"Steel Bow","behaviour":"bow"},{"match":"exact","pattern":"Crossbow","behaviour":"bow"},{"match":"exact","pattern":"Wooden Crossbow","behaviour":"bow"},{"match":"exact","pattern":"Silver Crossbow","behaviour":"bow"},{"match":"contains","pattern":"Crossbow","behaviour":"crossbow"},{"match":"contains","pattern":"Invis","behaviour":"hidesName"},{"match":"contains","pattern":" Chest","behaviour":"chest"},{"match":"contains","pattern":"Cabinet","behaviour":"cabinet"},{"match":"contains","pattern":"Wind Cabinet","behaviour":"windCabinet"},{"match":"contains","pattern":"Crate","behaviour":"crate"},{"match":"contains","pattern":"Cauldron","behaviour":"cauldron"},{"match":"contains","pattern":"Slot Machine","behaviour":"slotMachine"},{"match":"exact","pattern":"Blackjack Table","behaviour":"blackjackTable"},{"match":"exact","pattern":"Checkers Table","behaviour":"checkersTable"},{"match":"exact","pattern":"High Score Statue","behaviour":"highScoreStatue"},{"match":"exact","pattern":"Assassin Statue","behaviour":"assassinStatue"},{"match":"exact","pattern":"Camera","behaviour":"camera"},{"match":"contains","pattern":"Film","behaviour":"film"},{"match":"exact","pattern":"Canvas","behaviour":"canvas"},{"match":"exact","pattern":"Newspaper Kit","behaviour":"newspaperKit"},{"match":"exact","pattern":"Fire Staff","behaviour":"swingFireballs"},{"match":"exact","pattern":"Short Sword","behaviour":"sword"},{"match":"exact","pattern":"Long Sword","behaviour":"sword"},{"match":"exact","pattern":"Broad Sword","behaviour":"sword"},{"match":"exact","pattern":"Knight''s Sword","behaviour":"sword"},{"match":"exact","pattern":"Star Sword","behaviour":"sword"},{"match":"exact","pattern":"Sword of Hope","behaviour":"sword"},{"match":"exact","pattern":"Ice Sword","behaviour":"sword"},{"match":"exact","pattern":"Fire Sword","behaviour":"sword"},{"match":"exact","pattern":"Pharaoh Sword","behaviour":"sword"},{"match":"exact","pattern":"Dragon Sword","behaviour":"sword"},{"match":"exact","pattern":"Dark Sword","behaviour":"sword"},{"match":"exact","pattern":"Gold Sword","behaviour":"sword"},{"match":"exact","pattern":"Laser Sword","behaviour":"sword"},{"match":"exact","pattern":"Green Laser Sword","behaviour":"sword"},{"match":"contains","pattern":"Damaged Sword","behaviour":"sword"},{"match":"exact","pattern":"Purple Potion","behaviour":"argonsFist"},{"match":"exact","pattern":"Pig","behaviour":"releasesMonster"},{"match":"exact","pattern":"Robe of Invisibility","behaviour":"hidesHead"},{"match":"exact","pattern":"Ninja Outfit","behaviour":"hidesHead"},{"match":"exact","pattern":"Royal Ninja Uniform","behaviour":"hidesHead"},{"match":"exact","pattern":"Necromancer''s Robe","behaviour":"hidesHead"},{"match":"exact","pattern":"Robe of Invisibility","behaviour":"hidesHelm"},{"match":"exact","pattern":"Necromancer''s Robe","behaviour":"hidesHelm"},{"match":"contains","pattern":"Arrows","behaviour":"quiver"},{"match":"exact","pattern":"Torch","behaviour":"hiddenFacingNorth"},{"match":"contains","pattern":"door","behaviour":"door"},{"match":"contains","pattern":"Switch Door","behaviour":"switchDoor"},{"match":"contains","pattern":"Clock","behaviour":"clock"},{"match":"exact","pattern":"Message Boards","behaviour":"messageBoard"},{"match":"contains","pattern":"Universal Mail","behaviour":"universalMail"},{"match":"exact","pattern":"Guild Center","behaviour":"guildCenter"},{"match":"exact","pattern":"Vault","behaviour":"personalVault"},{"match":"contains","pattern":" Ray","behaviour":"noClick"},{"match":"contains","pattern":"Sign","behaviour":"noClick"},{"match":"contains","pattern":"Lair","behaviour":"noClick"},{"match":"contains","pattern":"Sign","behaviour":"noCtrl"},{"match":"contains","pattern":"Board","behaviour":"noCtrl"},{"match":"contains","pattern":" Chest","behaviour":"noCtrl"},{"match":"contains","pattern":"Mail","behaviour":"noCtrl"},{"match":"contains","pattern":"Vault","behaviour":"noCtrl"},{"match":"contains","pattern":"Platform","behaviour":"noCtrl"},{"match":"contains","pattern":"Lair","behaviour":"noCtrl"},{"match":"exact","pattern":"Chimney","behaviour":"noCtrl"}]')))
WHERE source = 'imported' AND json_type(data, '$.data."item-rules"') = 'object';

-- The engine also read two items by name that are now plain rows: the Ring of Experience's +5 kill
-- XP is a `gear` row (power `killXp`), and the Piano's "You can't use this." is a `use.refusals`
-- row. An imported pack that has neither gets Classic's, and so does an operator's or the draft's
-- own `gear` or `use` section, which would otherwise hide Classic's new row.
UPDATE content_packs
SET data = json_insert(data, '$.data."item-rules".gear[#]',
  json('{"slot":"ring","match":"exact","pattern":"Ring of Experience","power":"killXp","add":5}'))
WHERE source = 'imported' AND json_type(data, '$.data."item-rules".gear') = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(data, '$.data."item-rules".gear') g
    WHERE json_extract(g.value, '$.power') = 'killXp'
  );
UPDATE content_packs
SET data = json_insert(data, '$.data."item-rules".use.refusals[#]',
  json('{"match":"exact","pattern":"Piano","text":"You can''t use this."}'))
WHERE source = 'imported' AND json_type(data, '$.data."item-rules".use.refusals') = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(data, '$.data."item-rules".use.refusals') r
    WHERE lower(json_extract(r.value, '$.pattern')) = 'piano'
  );
UPDATE content_rows
SET data = json_insert(data, '$[#]',
  json('{"slot":"ring","match":"exact","pattern":"Ring of Experience","power":"killXp","add":5}'))
WHERE dataset = 'itemRules' AND part = 'gear' AND op = 'set' AND json_type(data) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(content_rows.data) g WHERE json_extract(g.value, '$.power') = 'killXp'
  );
UPDATE content_draft
SET data = json_insert(data, '$[#]',
  json('{"slot":"ring","match":"exact","pattern":"Ring of Experience","power":"killXp","add":5}'))
WHERE dataset = 'itemRules' AND part = 'gear' AND op = 'set' AND json_type(data) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(content_draft.data) g WHERE json_extract(g.value, '$.power') = 'killXp'
  );
UPDATE content_rows
SET data = json_insert(data, '$.refusals[#]',
  json('{"match":"exact","pattern":"Piano","text":"You can''t use this."}'))
WHERE dataset = 'itemRules' AND part = 'use' AND op = 'set'
  AND json_type(data, '$.refusals') = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(content_rows.data, '$.refusals') r
    WHERE lower(json_extract(r.value, '$.pattern')) = 'piano'
  );
UPDATE content_draft
SET data = json_insert(data, '$.refusals[#]',
  json('{"match":"exact","pattern":"Piano","text":"You can''t use this."}'))
WHERE dataset = 'itemRules' AND part = 'use' AND op = 'set'
  AND json_type(data, '$.refusals') = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(content_draft.data, '$.refusals') r
    WHERE lower(json_extract(r.value, '$.pattern')) = 'piano'
  );

-- The publish log keeps each publish's rows before and after, and undo compares the live row with
-- the "after": both get the same rows, so a publish made before the upgrade can still be undone,
-- and undoing it keeps the ring's bonus and the Piano's line.
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'itemRules' AND json_extract(c.value, '$.part') = 'gear'
      AND json_type(c.value, '$.before.data') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(c.value, '$.before.data') r WHERE json_extract(r.value, '$.power') = 'killXp'
      )
    THEN json_insert(c.value, '$.before.data[#]', json('{"slot":"ring","match":"exact","pattern":"Ring of Experience","power":"killXp","add":5}'))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'itemRules' AND json_extract(c.value, '$.part') = 'gear'
);
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'itemRules' AND json_extract(c.value, '$.part') = 'use'
      AND json_type(c.value, '$.before.data.refusals') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(c.value, '$.before.data.refusals') r WHERE lower(json_extract(r.value, '$.pattern')) = 'piano'
      )
    THEN json_insert(c.value, '$.before.data.refusals[#]', json('{"match":"exact","pattern":"Piano","text":"You can''t use this."}'))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'itemRules' AND json_extract(c.value, '$.part') = 'use'
);
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'itemRules' AND json_extract(c.value, '$.part') = 'gear'
      AND json_type(c.value, '$.after.data') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(c.value, '$.after.data') r WHERE json_extract(r.value, '$.power') = 'killXp'
      )
    THEN json_insert(c.value, '$.after.data[#]', json('{"slot":"ring","match":"exact","pattern":"Ring of Experience","power":"killXp","add":5}'))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'itemRules' AND json_extract(c.value, '$.part') = 'gear'
);
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.dataset') = 'itemRules' AND json_extract(c.value, '$.part') = 'use'
      AND json_type(c.value, '$.after.data.refusals') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(c.value, '$.after.data.refusals') r WHERE lower(json_extract(r.value, '$.pattern')) = 'piano'
      )
    THEN json_insert(c.value, '$.after.data.refusals[#]', json('{"match":"exact","pattern":"Piano","text":"You can''t use this."}'))
    ELSE c.value
  END))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(content_publishes.changes) c
  WHERE json_extract(c.value, '$.dataset') = 'itemRules' AND json_extract(c.value, '$.part') = 'use'
);
