-- migrate: foreign_keys off
-- Skills by key (issue #37 stage 1). A character's skills were saved by each skill's position in
-- the content's skill list, so a skill could never be removed or moved. They are now saved under
-- each skill's key (classes.json `skills[].skill`): skills may be added, removed or reordered, and
-- a removed skill's values stay saved for it to return to. Each saved position becomes the key the
-- server recorded for it (`content_skills`), else Classic's skill at that position; a position
-- neither knows keeps its number as '#<n>', unread but not lost.
CREATE TABLE skill_keys_58 (
  idx INTEGER PRIMARY KEY,
  skill TEXT NOT NULL,
  display TEXT,
  hidden INTEGER NOT NULL
);
INSERT INTO skill_keys_58 (idx, skill, display, hidden)
  SELECT idx, skill, NULL, 0 FROM content_skills;
-- Classic's 38 skills in their saved order, with the Skills page names and the three skills 1.6
-- never showed.
CREATE TABLE classic_skills_58 (
  idx INTEGER PRIMARY KEY,
  skill TEXT NOT NULL,
  display TEXT,
  hidden INTEGER NOT NULL
);
INSERT INTO classic_skills_58 (idx, skill, display, hidden) VALUES
  (1, 'Slash', NULL, 0),
  (2, 'Thrust', NULL, 0),
  (3, 'Parry', NULL, 0),
  (4, 'HeavyArms', 'Heavy Arms', 0),
  (5, 'AxeFighting', 'Axe Fighting', 0),
  (6, 'Swordsmanship', NULL, 0),
  (7, 'Fencing', NULL, 0),
  (8, 'Magery', NULL, 0),
  (9, 'BlackArts', 'Black Arts', 0),
  (10, 'UnholyCombat', 'Unholy Combat', 0),
  (11, 'Archery', NULL, 0),
  (12, 'Meditation', NULL, 1),
  (13, 'Blessing', NULL, 0),
  (14, 'Sorcery', NULL, 0),
  (15, 'Musicianship', NULL, 0),
  (16, 'TerrainNavigating', 'Terrain Navigating', 1),
  (17, 'StaffFighting', 'Staff Fighting', 0),
  (18, 'ItemIdentification', 'Item Identification', 1),
  (19, 'Illusion', NULL, 0),
  (20, 'HammerWielding', 'Hammer Wielding', 0),
  (21, 'fire', 'Fire', 0),
  (22, 'Water', NULL, 0),
  (23, 'wind', 'Wind', 0),
  (24, 'Earth', NULL, 0),
  (25, 'Block', NULL, 0),
  (26, 'MartialArts', 'Martial Arts', 0),
  (27, 'Wizardry', NULL, 0),
  (28, 'Wrath', NULL, 0),
  (29, 'Punch', NULL, 0),
  (30, 'Cooking', NULL, 0),
  (31, 'Alchemy', NULL, 0),
  (32, 'Lumberjacking', NULL, 0),
  (33, 'Carpentry', NULL, 0),
  (34, 'Fishing', NULL, 0),
  (35, 'Blacksmithing', NULL, 0),
  (36, 'Mining', NULL, 0),
  (37, 'Shoveling', NULL, 0),
  (38, 'Farming', NULL, 0);
INSERT OR IGNORE INTO skill_keys_58 (idx, skill, display, hidden)
  SELECT idx, skill, display, hidden FROM classic_skills_58;

CREATE TABLE character_skills_new (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill TEXT NOT NULL CHECK (skill <> ''),
  value INTEGER NOT NULL,
  PRIMARY KEY (character_id, skill)
);
INSERT INTO character_skills_new (character_id, skill, value)
  SELECT s.character_id, COALESCE(k.skill, '#' || s.skill), s.value
  FROM character_skills s LEFT JOIN skill_keys_58 k ON k.idx = s.skill;
DROP TABLE character_skills;
ALTER TABLE character_skills_new RENAME TO character_skills;

-- The character editor's log kept a skills change as two lists by position; each becomes an object
-- keyed the same way, so an undo still puts every value back on its own skill.
UPDATE character_edits
SET changes = (
  SELECT json_group_array(
    CASE
      WHEN json_extract(c.value, '$.field') = 'skills'
        AND json_type(c.value, '$.before') = 'array'
        AND json_type(c.value, '$.after') = 'array'
      THEN json_object(
        'field', 'skills',
        'before', json((
          SELECT json_group_object(COALESCE(k.skill, '#' || (v.key + 1)), v.value)
          FROM json_each(c.value, '$.before') v LEFT JOIN skill_keys_58 k ON k.idx = v.key + 1
        )),
        'after', json((
          SELECT json_group_object(COALESCE(k.skill, '#' || (v.key + 1)), v.value)
          FROM json_each(c.value, '$.after') v LEFT JOIN skill_keys_58 k ON k.idx = v.key + 1
        ))
      )
      ELSE json(c.value)
    END
  )
  FROM json_each(character_edits.changes) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(character_edits.changes) c WHERE json_extract(c.value, '$.field') = 'skills'
);

-- The content's shape follows (classes.json):
-- - a skill row loses its `index`, and takes the Skills page name (`display`) and `hidden` the
--   page list (`skillPanel`) gave it; that list is gone, so the operator's and the draft's copies
--   of it go too;
-- - the start classes leave `creation` (`classes`, `startingSkills`) for their own rows
--   (`startClasses`: code, label, starting skills by key), in the screen's order: Fighter,
--   Ranger, Mage. An operator's changed starting skills or labels become those rows.
-- A publish logged before this keeps the old shapes, so undoing one is refused as not matching
-- the schemas.
UPDATE content_rows
SET data = (
  SELECT CASE
    WHEN k.display IS NOT NULL AND json_type(content_rows.data, '$.display') IS NULL
      THEN json_set(json_remove(content_rows.data, '$.index'), '$.display', k.display)
    ELSE json_remove(content_rows.data, '$.index')
  END
  FROM (SELECT 1) LEFT JOIN classic_skills_58 k ON lower(k.skill) = lower(content_rows.row_key)
)
WHERE dataset = 'classes' AND part = 'skills' AND op = 'set';
UPDATE content_rows
SET data = json_set(data, '$.hidden', json('true'))
WHERE dataset = 'classes' AND part = 'skills' AND op = 'set'
  AND lower(row_key) IN (SELECT lower(skill) FROM classic_skills_58 WHERE hidden = 1)
  AND json_type(data, '$.hidden') IS NULL;
UPDATE content_draft
SET data = json_remove(data, '$.index')
WHERE dataset = 'classes' AND part = 'skills' AND op = 'set';
DELETE FROM content_rows WHERE dataset = 'classes' AND part = 'skillPanel';
DELETE FROM content_draft WHERE dataset = 'classes' AND part = 'skillPanel';

-- An operator's start classes, from a changed `creation` row: one row per class whose label or
-- starting values differ from what its change was based on.
CREATE TABLE start_classes_58 (pos INTEGER PRIMARY KEY, code TEXT NOT NULL);
INSERT INTO start_classes_58 (pos, code) VALUES (1, '1'), (2, '3'), (3, '2');
INSERT OR REPLACE INTO content_rows
  (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at)
SELECT 'classes', 'startClasses', sc.code, 'set',
  json_object(
    'code', CAST(sc.code AS INTEGER),
    'label', json_extract(r.data, '$.classes."' || sc.code || '"'),
    'skills', json(COALESCE((
      SELECT json_group_object(k.skill, v.value)
      FROM json_each(r.data, '$.startingSkills."' || sc.code || '".values') v
      JOIN skill_keys_58 k ON k.idx = v.key + 1
      WHERE v.value <> 1
    ), '{}'))
  ),
  NULL, NULL, r.seq + sc.pos, r.updated_by, r.updated_at
FROM content_rows r, start_classes_58 sc
WHERE r.dataset = 'classes' AND r.part = 'creation' AND r.op = 'set'
  AND (
    r.base_data IS NULL
    OR json_extract(r.data, '$.classes."' || sc.code || '"')
      IS NOT json_extract(r.base_data, '$.classes."' || sc.code || '"')
    OR json(json_extract(r.data, '$.startingSkills."' || sc.code || '".values'))
      IS NOT json(json_extract(r.base_data, '$.startingSkills."' || sc.code || '".values'))
  );
INSERT OR REPLACE INTO content_draft
  (dataset, part, row_key, op, data, author_account_id, author, updated_at)
SELECT 'classes', 'startClasses', sc.code, 'set',
  json_object(
    'code', CAST(sc.code AS INTEGER),
    'label', json_extract(r.data, '$.classes."' || sc.code || '"'),
    'skills', json(COALESCE((
      SELECT json_group_object(k.skill, v.value)
      FROM json_each(r.data, '$.startingSkills."' || sc.code || '".values') v
      JOIN skill_keys_58 k ON k.idx = v.key + 1
      WHERE v.value <> 1
    ), '{}'))
  ),
  r.author_account_id, r.author, r.updated_at
FROM content_draft r, start_classes_58 sc
WHERE r.dataset = 'classes' AND r.part = 'creation' AND r.op = 'set'
  AND json_type(r.data, '$.startingSkills') = 'object';
UPDATE content_rows
SET data = json_remove(data, '$.classes', '$.startingSkills', '$.skillsWritten'),
  base_data = json_remove(base_data, '$.classes', '$.startingSkills', '$.skillsWritten')
WHERE dataset = 'classes' AND part = 'creation';
UPDATE content_draft
SET data = json_remove(data, '$.classes', '$.startingSkills', '$.skillsWritten')
WHERE dataset = 'classes' AND part = 'creation';

-- An imported pack's classes take the same shape.
UPDATE content_packs
SET data = json_set(
  json_remove(
    data,
    '$.data.classes.skillPanel',
    '$.data.classes.creation.classes',
    '$.data.classes.creation.startingSkills',
    '$.data.classes.creation.skillsWritten'
  ),
  '$.data.classes.skills', json((
    SELECT json_group_array(json(
      CASE
        WHEN p.name IS NOT NULL AND p.name <> json_extract(s.value, '$.skill')
          THEN json_set(json_remove(s.value, '$.index'), '$.display', p.name)
        WHEN p.name IS NULL
          THEN json_set(json_remove(s.value, '$.index'), '$.hidden', json('true'))
        ELSE json_remove(s.value, '$.index')
      END
    ))
    FROM json_each(content_packs.data, '$.data.classes.skills') s
    LEFT JOIN (
      SELECT json_extract(pr.value, '$.index') AS idx, json_extract(pr.value, '$.name') AS name
      FROM json_each(content_packs.data, '$.data.classes.skillPanel') pr
    ) p ON p.idx = json_extract(s.value, '$.index')
  )),
  '$.data.classes.startClasses', json((
    SELECT json_group_array(json_object(
      'code', CAST(sc.code AS INTEGER),
      'label', json_extract(content_packs.data, '$.data.classes.creation.classes."' || sc.code || '"'),
      'skills', json(COALESCE((
        SELECT json_group_object(json_extract(sk.value, '$.skill'), v.value)
        FROM json_each(
          content_packs.data, '$.data.classes.creation.startingSkills."' || sc.code || '".values'
        ) v
        JOIN json_each(content_packs.data, '$.data.classes.skills') sk
          ON json_extract(sk.value, '$.index') = v.key + 1
        WHERE v.value <> 1
      ), '{}'))
    ))
    FROM start_classes_58 sc
  ))
)
WHERE source = 'imported' AND json_type(data, '$.data.classes.skills') = 'array'
  AND json_type(data, '$.data.classes.creation.startingSkills') = 'object';

DROP TABLE start_classes_58;
DROP TABLE classic_skills_58;
DROP TABLE skill_keys_58;
-- Positions no longer need guarding.
DROP TABLE content_skills;
