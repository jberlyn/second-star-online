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
  SELECT idx, skill, display, hidden FROM classic_skills_58
  WHERE skill NOT IN (SELECT skill FROM skill_keys_58);
-- A skill only the draft adds was never live, but the draft's starting values may name it.
INSERT OR IGNORE INTO skill_keys_58 (idx, skill, display, hidden)
  SELECT json_extract(data, '$.index'), json_extract(data, '$.skill'), NULL, 0
  FROM content_draft
  WHERE dataset = 'classes' AND part = 'skills' AND op = 'set'
    AND json_type(data, '$.index') = 'integer' AND json_type(data, '$.skill') = 'text'
    AND json_extract(data, '$.skill') NOT IN (SELECT skill FROM skill_keys_58);

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

-- The character editor's log kept a skills change as two lists by position; it becomes two objects
-- holding only the skills the edit moved, by key, as the editor now logs them, so an undo puts
-- each value back on its own skill and is not stopped by a skill the edit never touched.
UPDATE character_edits
SET changes = (
  SELECT json_group_array(
    CASE
      WHEN json_extract(c.value, '$.field') = 'skills'
        AND json_type(c.value, '$.before') = 'array'
        AND json_type(c.value, '$.after') = 'array'
      THEN json_object(
        'field', 'skills',
        'before', json(COALESCE((
          SELECT json_group_object(COALESCE(k.skill, '#' || (b.key + 1)), b.value)
          FROM json_each(c.value, '$.before') b
          JOIN json_each(c.value, '$.after') a ON a.key = b.key
          LEFT JOIN skill_keys_58 k ON k.idx = b.key + 1
          WHERE a.value IS NOT b.value
        ), '{}')),
        'after', json(COALESCE((
          SELECT json_group_object(COALESCE(k.skill, '#' || (a.key + 1)), a.value)
          FROM json_each(c.value, '$.after') a
          JOIN json_each(c.value, '$.before') b ON b.key = a.key
          LEFT JOIN skill_keys_58 k ON k.idx = a.key + 1
          WHERE a.value IS NOT b.value
        ), '{}'))
      )
      ELSE json(c.value)
    END
  )
  FROM (SELECT key, value FROM json_each(character_edits.changes) ORDER BY key) c
)
WHERE EXISTS (
  SELECT 1 FROM json_each(character_edits.changes) c WHERE json_extract(c.value, '$.field') = 'skills'
);

-- The content's shape follows (classes.json):
-- - a skill row loses its `index`, and takes the Skills page name (`display`) and `hidden` the
--   page list (`skillPanel`) gave it; that list is gone, and an operator's or a draft's copy of it
--   becomes those fields on the skills' rows (below);
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
UPDATE content_rows
SET base_data = json_remove(base_data, '$.index')
WHERE dataset = 'classes' AND part = 'skills' AND base_data IS NOT NULL;
UPDATE content_draft
SET data = json_remove(data, '$.index')
WHERE dataset = 'classes' AND part = 'skills' AND op = 'set';

-- The operator's and the draft's Skills page (`skillPanel`) becomes each skill's own `display` and
-- `hidden`: a skill the page named differently from its key takes that name, and a skill the page
-- left out is hidden. Where that differs from the skill's row as it now stands (the operator's or
-- draft's own row, else Classic's), the row is changed. The page's own order is not kept: the
-- Skills page lists the skills in their order.
CREATE TABLE panel_58 (
  source TEXT NOT NULL,
  idx INTEGER NOT NULL,
  skill TEXT NOT NULL,
  name TEXT,
  base TEXT NOT NULL,
  PRIMARY KEY (source, idx)
);
INSERT INTO panel_58 (source, idx, skill, name, base)
SELECT 'rows', k.idx, k.skill,
  (
    SELECT json_extract(p.value, '$.name')
    FROM content_rows r, json_each(r.data) p
    WHERE r.dataset = 'classes' AND r.part = 'skillPanel' AND r.op = 'set'
      AND json_extract(p.value, '$.index') = k.idx
    ORDER BY p.key
    LIMIT 1
  ),
  COALESCE(
    (
      SELECT r.data FROM content_rows r
      WHERE r.dataset = 'classes' AND r.part = 'skills' AND r.op = 'set'
        AND lower(r.row_key) = lower(k.skill)
    ),
    (
      SELECT json_patch(
        json_object('skill', c.skill),
        json_patch(
          CASE WHEN c.display IS NULL THEN '{}' ELSE json_object('display', c.display) END,
          CASE WHEN c.hidden = 1 THEN '{"hidden":true}' ELSE '{}' END
        )
      )
      FROM classic_skills_58 c WHERE c.idx = k.idx AND c.skill = k.skill
    )
  )
FROM skill_keys_58 k
WHERE EXISTS (
  SELECT 1 FROM content_rows WHERE dataset = 'classes' AND part = 'skillPanel' AND op = 'set'
)
  AND NOT EXISTS (
    SELECT 1 FROM content_rows r
    WHERE r.dataset = 'classes' AND r.part = 'skills' AND r.op = 'remove'
      AND lower(r.row_key) = lower(k.skill)
  )
  AND (
    EXISTS (SELECT 1 FROM classic_skills_58 c WHERE c.idx = k.idx AND c.skill = k.skill)
    OR EXISTS (
      SELECT 1 FROM content_rows r
      WHERE r.dataset = 'classes' AND r.part = 'skills' AND r.op = 'set'
        AND lower(r.row_key) = lower(k.skill)
    )
  );
DELETE FROM panel_58 WHERE base IS NULL;
-- What each row should hold: the page's name as `display` (none when it is the key), or hidden,
-- keeping its own `display`, when the page left it out.
CREATE TABLE panel_want_58 AS
SELECT source, skill, base,
  CASE
    WHEN name IS NULL THEN json_set(base, '$.hidden', json('true'))
    WHEN name <> skill THEN json_set(json_remove(base, '$.display', '$.hidden'), '$.display', name)
    ELSE json_remove(base, '$.display', '$.hidden')
  END AS want
FROM panel_58;
DELETE FROM panel_want_58
WHERE json_extract(want, '$.display') IS json_extract(base, '$.display')
  AND json_extract(want, '$.hidden') IS json_extract(base, '$.hidden');
UPDATE content_rows
SET data = (
  SELECT w.want FROM panel_want_58 w
  WHERE w.source = 'rows' AND lower(w.skill) = lower(content_rows.row_key)
)
WHERE dataset = 'classes' AND part = 'skills' AND op = 'set'
  AND lower(row_key) IN (SELECT lower(skill) FROM panel_want_58 WHERE source = 'rows');
INSERT INTO content_rows
  (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at)
SELECT 'classes', 'skills', w.skill, 'set', w.want, NULL, NULL,
  (SELECT COALESCE(MAX(seq), 0) FROM content_rows) + ROW_NUMBER() OVER (ORDER BY w.skill),
  r.updated_by, r.updated_at
FROM panel_want_58 w
JOIN content_rows r ON r.dataset = 'classes' AND r.part = 'skillPanel' AND r.op = 'set'
WHERE w.source = 'rows'
  AND NOT EXISTS (
    SELECT 1 FROM content_rows x
    WHERE x.dataset = 'classes' AND x.part = 'skills' AND lower(x.row_key) = lower(w.skill)
  );
-- A drafted skill row (made before rows had `display` or `hidden`) takes them from the skill's
-- published row as it now stands, else Classic's, so publishing it keeps the skill's name and
-- whether it shows.
UPDATE content_draft
SET data = json_patch(data, (
  SELECT json_patch(
    CASE WHEN src.display IS NULL OR json_type(content_draft.data, '$.display') IS NOT NULL
      THEN '{}' ELSE json_object('display', src.display) END,
    CASE WHEN src.hidden IS NOT 1 OR json_type(content_draft.data, '$.hidden') IS NOT NULL
      THEN '{}' ELSE '{"hidden":true}' END
  )
  FROM (
    SELECT
      CASE WHEN r.data IS NOT NULL THEN json_extract(r.data, '$.display') ELSE c.display END
        AS display,
      CASE WHEN r.data IS NOT NULL THEN json_extract(r.data, '$.hidden') ELSE c.hidden END
        AS hidden
    FROM (SELECT 1)
    LEFT JOIN content_rows r ON r.dataset = 'classes' AND r.part = 'skills' AND r.op = 'set'
      AND lower(r.row_key) = lower(content_draft.row_key)
    LEFT JOIN classic_skills_58 c ON lower(c.skill) = lower(content_draft.row_key)
  ) src
))
WHERE dataset = 'classes' AND part = 'skills' AND op = 'set';

-- Then the draft's page, against the published rows as they now stand.
DROP TABLE panel_want_58;
DELETE FROM panel_58;
INSERT INTO panel_58 (source, idx, skill, name, base)
SELECT 'draft', k.idx, k.skill,
  (
    SELECT json_extract(p.value, '$.name')
    FROM content_draft d, json_each(d.data) p
    WHERE d.dataset = 'classes' AND d.part = 'skillPanel' AND d.op = 'set'
      AND json_extract(p.value, '$.index') = k.idx
    ORDER BY p.key
    LIMIT 1
  ),
  COALESCE(
    (
      SELECT json_remove(d.data, '$.index') FROM content_draft d
      WHERE d.dataset = 'classes' AND d.part = 'skills' AND d.op = 'set'
        AND lower(d.row_key) = lower(k.skill)
    ),
    (
      SELECT r.data FROM content_rows r
      WHERE r.dataset = 'classes' AND r.part = 'skills' AND r.op = 'set'
        AND lower(r.row_key) = lower(k.skill)
    ),
    (
      SELECT json_patch(
        json_object('skill', c.skill),
        json_patch(
          CASE WHEN c.display IS NULL THEN '{}' ELSE json_object('display', c.display) END,
          CASE WHEN c.hidden = 1 THEN '{"hidden":true}' ELSE '{}' END
        )
      )
      FROM classic_skills_58 c WHERE c.idx = k.idx AND c.skill = k.skill
    ),
    (
      SELECT json_object('skill', k.skill) FROM content_draft d
      WHERE d.dataset = 'classes' AND d.part = 'skills' AND d.op = 'set'
        AND lower(d.row_key) = lower(k.skill)
    )
  )
FROM skill_keys_58 k
WHERE EXISTS (
  SELECT 1 FROM content_draft WHERE dataset = 'classes' AND part = 'skillPanel' AND op = 'set'
);
DELETE FROM panel_58 WHERE base IS NULL;
CREATE TABLE panel_want_58 AS
SELECT source, skill, base,
  CASE
    WHEN name IS NULL THEN json_set(base, '$.hidden', json('true'))
    WHEN name <> skill THEN json_set(json_remove(base, '$.display', '$.hidden'), '$.display', name)
    ELSE json_remove(base, '$.display', '$.hidden')
  END AS want
FROM panel_58;
DELETE FROM panel_want_58
WHERE json_extract(want, '$.display') IS json_extract(base, '$.display')
  AND json_extract(want, '$.hidden') IS json_extract(base, '$.hidden');
INSERT OR REPLACE INTO content_draft
  (dataset, part, row_key, op, data, author_account_id, author, updated_at)
SELECT 'classes', 'skills', COALESCE(
    (
      SELECT x.row_key FROM content_draft x
      WHERE x.dataset = 'classes' AND x.part = 'skills' AND lower(x.row_key) = lower(w.skill)
    ),
    w.skill
  ), 'set', w.want, d.author_account_id, d.author, d.updated_at
FROM panel_want_58 w
JOIN content_draft d ON d.dataset = 'classes' AND d.part = 'skillPanel' AND d.op = 'set'
WHERE w.source = 'draft';
DROP TABLE panel_want_58;
DROP TABLE panel_58;
DELETE FROM content_rows WHERE dataset = 'classes' AND part = 'skillPanel';
DELETE FROM content_draft WHERE dataset = 'classes' AND part = 'skillPanel';

-- An operator's start classes, from a changed `creation` row: one row per class whose label or
-- starting values differ from what its change was based on.
CREATE TABLE start_classes_58 (pos INTEGER PRIMARY KEY, code TEXT NOT NULL);
INSERT INTO start_classes_58 (pos, code) VALUES (1, '1'), (2, '3'), (3, '2');
INSERT OR REPLACE INTO content_rows
  (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at)
SELECT 'classes', 'startClasses', sc.code, 'set',
  json_patch(
    CASE WHEN COALESCE(json_extract(r.data, '$.classes."' || sc.code || '"'), '') = '' THEN '{}'
      ELSE json_object('label', json_extract(r.data, '$.classes."' || sc.code || '"')) END,
    json_object(
    'code', CAST(sc.code AS INTEGER),
    'skills', json(COALESCE((
      SELECT json_group_object(k.skill, v.value)
      FROM json_each(r.data, '$.startingSkills."' || sc.code || '".values') v
      JOIN skill_keys_58 k ON k.idx = v.key + 1
      WHERE v.value <> 1
    ), '{}'))
  )),
  NULL, NULL, (SELECT COALESCE(MAX(seq), 0) FROM content_rows) + sc.pos, r.updated_by, r.updated_at
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
  json_patch(
    CASE WHEN COALESCE(json_extract(r.data, '$.classes."' || sc.code || '"'), '') = '' THEN '{}'
      ELSE json_object('label', json_extract(r.data, '$.classes."' || sc.code || '"')) END,
    json_object(
    'code', CAST(sc.code AS INTEGER),
    'skills', json(COALESCE((
      SELECT json_group_object(k.skill, v.value)
      FROM json_each(r.data, '$.startingSkills."' || sc.code || '".values') v
      JOIN skill_keys_58 k ON k.idx = v.key + 1
      WHERE v.value <> 1
    ), '{}'))
  )),
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
        WHEN s.name IS NOT NULL AND s.name <> json_extract(s.value, '$.skill')
          THEN json_set(json_remove(s.value, '$.index'), '$.display', s.name)
        WHEN s.name IS NULL
          AND json_type(content_packs.data, '$.data.classes.skillPanel') = 'array'
          THEN json_set(json_remove(s.value, '$.index'), '$.hidden', json('true'))
        ELSE json_remove(s.value, '$.index')
      END
    ))
    FROM (
      -- Each skill once, in the pack's order, with the first page row that shows it.
      SELECT sk.key AS pos, sk.value AS value, (
        SELECT json_extract(pr.value, '$.name')
        FROM json_each(content_packs.data, '$.data.classes.skillPanel') pr
        WHERE json_extract(pr.value, '$.index') = json_extract(sk.value, '$.index')
        ORDER BY pr.key
        LIMIT 1
      ) AS name
      FROM json_each(content_packs.data, '$.data.classes.skills') sk
      ORDER BY sk.key
    ) s
  )),
  '$.data.classes.startClasses', json((
    SELECT json_group_array(json_patch(
      CASE
        WHEN COALESCE(
          json_extract(content_packs.data, '$.data.classes.creation.classes."' || sc.code || '"'), ''
        ) = '' THEN '{}'
        ELSE json_object(
          'label',
          json_extract(content_packs.data, '$.data.classes.creation.classes."' || sc.code || '"')
        )
      END,
      json_object(
      'code', CAST(sc.code AS INTEGER),
      'skills', json(COALESCE((
        SELECT json_group_object(json_extract(sk.value, '$.skill'), v.value)
        FROM json_each(
          content_packs.data, '$.data.classes.creation.startingSkills."' || sc.code || '".values'
        ) v
        JOIN json_each(content_packs.data, '$.data.classes.skills') sk
          ON json_extract(sk.value, '$.index') = v.key + 1
        WHERE v.value <> 1
      ), '{}'))
    )))
    FROM (SELECT pos, code FROM start_classes_58 ORDER BY pos) sc
  ))
)
WHERE source = 'imported' AND json_type(data, '$.data.classes.skills') = 'array'
  AND json_type(data, '$.data.classes.creation.startingSkills') = 'object';

DROP TABLE start_classes_58;
DROP TABLE classic_skills_58;
DROP TABLE skill_keys_58;
-- Positions no longer need guarding.
DROP TABLE content_skills;
