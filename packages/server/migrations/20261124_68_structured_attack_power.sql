-- Structured attack power (#30 stage 1). attpower.json's base rolls kept display text (`expr`) and
-- a hidden switch for the Gold Axe's Strength roll (`extra`), and its tier values (shared with the
-- spell power tables in spells.json) could be formula text, "random(4)" or "2 + random(3)". They
-- are now parts only, as the balance amounts are: a base row is `{ match, pattern, flat, randomN,
-- strengthHalf? }` (a `randomN` of 0 rolls nothing, where it was null), and a tier value is a
-- number or `{ flat, randomN }`.
--
-- It plays exactly as before: a null roll drew nothing and becomes 0; a roll of 0 or below drew once
-- and gave 0 (`random(n)` for n below 1), so it becomes `random(1)` (always 1) with `flat` one
-- lower; the Strength roll is kept only where the old code ran it, a base row whose `extra` was
-- set (not empty), never an `exactOverrides` row, which ignored it.
--
-- Every stored copy of those datasets gets the new shape, so it plays as it did: an imported
-- pack's, the operator's rows and the pack rows they were made over (whose hash is then worked out
-- when read, so an unchanged pack row raises no notice), the draft's, and the rows the publish log
-- keeps for undo. Only the attPower and spells datasets are touched (the progression formulas in
-- classes.json keep their text). Running it again changes nothing.

-- The documents to reshape: each one a whole attPower or spells value.
CREATE TEMP TABLE docs68 (
  doc_id INTEGER PRIMARY KEY,
  target TEXT NOT NULL,
  k1 TEXT,
  k2 TEXT,
  k3 TEXT,
  col TEXT NOT NULL,
  doc TEXT NOT NULL
);
INSERT INTO docs68 (target, k1, col, doc)
SELECT 'pack', id, p.col, json_extract(data, p.col)
FROM content_packs, (SELECT '$.data.attpower' AS col UNION ALL SELECT '$.data.spells') p
WHERE data IS NOT NULL AND json_type(data, p.col) IN ('object', 'array');
INSERT INTO docs68 (target, k1, k2, k3, col, doc)
SELECT 'row', dataset, part, row_key, 'data', data FROM content_rows
WHERE dataset IN ('attPower', 'spells') AND json_type(data) IN ('object', 'array');
INSERT INTO docs68 (target, k1, k2, k3, col, doc)
SELECT 'row', dataset, part, row_key, 'base_data', base_data FROM content_rows
WHERE dataset IN ('attPower', 'spells') AND json_type(base_data) IN ('object', 'array');
INSERT INTO docs68 (target, k1, k2, k3, col, doc)
SELECT 'draft', dataset, part, row_key, 'data', data FROM content_draft
WHERE dataset IN ('attPower', 'spells') AND json_type(data) IN ('object', 'array');
INSERT INTO docs68 (target, k1, k2, col, doc)
SELECT 'pub', p.id, c.key, 'change', c.value
FROM content_publishes p, json_each(p.changes) c
WHERE json_extract(c.value, '$.dataset') IN ('attPower', 'spells');

-- Every object of every document, read once (each object's own fields are read from its value,
-- so the work grows with the size of the documents, not its square).
CREATE TEMP TABLE objs68 (doc_id INTEGER NOT NULL, fullkey TEXT NOT NULL, path TEXT NOT NULL, v TEXT NOT NULL);
INSERT INTO objs68 (doc_id, fullkey, path, v)
SELECT d.doc_id, o.fullkey, o.path, o.value FROM docs68 d, json_tree(d.doc) o WHERE o.type = 'object';

-- The edits, one path each (none moves another's path).
CREATE TEMP TABLE edits68 (doc_id INTEGER NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, val TEXT);

-- A tier value written as text. The schemas before this one took any text (before 137ea10) and then
-- `a + random(n)`, `random(n)` or a number; read here with spaces anywhere, a leading sign on a
-- number, and `random(n) + a`. `t` is the text with every space and tab taken out.
CREATE TEMP TABLE vals68 (doc_id INTEGER NOT NULL, path TEXT NOT NULL, t TEXT NOT NULL,
  ok INTEGER, flat INTEGER, n INTEGER);
INSERT INTO vals68 (doc_id, path, t)
SELECT doc_id, fullkey || '.value',
  replace(replace(json_extract(v, '$.value'), ' ', ''), char(9), '')
FROM objs68
WHERE json_type(v, '$.op') IS NOT NULL AND json_type(v, '$.value') = 'text';
-- A number: digits with an optional sign.
UPDATE vals68 SET ok = 1, n = NULL,
  flat = CASE WHEN substr(t, 1, 1) = '-' THEN -1 ELSE 1 END
    * CAST(CASE WHEN substr(t, 1, 1) IN ('+', '-') THEN substr(t, 2) ELSE t END AS INTEGER)
WHERE instr(t, 'random(') = 0
  AND length(CASE WHEN substr(t, 1, 1) IN ('+', '-') THEN substr(t, 2) ELSE t END) BETWEEN 1 AND 5
  AND CASE WHEN substr(t, 1, 1) IN ('+', '-') THEN substr(t, 2) ELSE t END NOT GLOB '*[^0-9]*';
-- A roll: `random(n)`, `a+random(n)` or `random(n)+a`.
UPDATE vals68 SET ok = 1,
  n = CAST(substr(t, instr(t, 'random(') + 7, instr(t, ')') - instr(t, 'random(') - 7) AS INTEGER),
  flat = CASE
    WHEN instr(t, 'random(') > 1 THEN CAST(substr(t, 1, instr(t, 'random(') - 2) AS INTEGER)
    WHEN instr(t, ')') < length(t) THEN CAST(substr(t, instr(t, ')') + 2) AS INTEGER)
    ELSE 0 END
WHERE ok IS NULL AND instr(t, 'random(') > 0 AND instr(t, ')') > instr(t, 'random(') + 7
  AND length(substr(t, instr(t, 'random(') + 7, instr(t, ')') - instr(t, 'random(') - 7)) <= 5
  AND substr(t, instr(t, 'random(') + 7, instr(t, ')') - instr(t, 'random(') - 7) NOT GLOB '*[^0-9]*'
  AND (
    (instr(t, 'random(') = 1 AND instr(t, ')') = length(t))
    OR (instr(t, ')') = length(t) AND substr(t, instr(t, 'random(') - 1, 1) = '+'
      AND length(substr(t, 1, instr(t, 'random(') - 2)) BETWEEN 1 AND 5
      AND substr(t, 1, instr(t, 'random(') - 2) NOT GLOB '*[^0-9]*')
    OR (instr(t, 'random(') = 1 AND substr(t, instr(t, ')') + 1, 1) = '+'
      AND length(substr(t, instr(t, ')') + 2)) BETWEEN 1 AND 5
      AND substr(t, instr(t, ')') + 2) NOT GLOB '*[^0-9]*')
  );
-- `random(0)` drew once and gave 0: `random(1)` draws once and gives 1, so `flat` is one lower.
INSERT INTO edits68 (doc_id, path, kind, val)
SELECT doc_id, path, 'set',
  CASE
    WHEN n IS NULL THEN CAST(flat AS TEXT)
    WHEN n = 0 THEN json_object('flat', flat - 1, 'randomN', 1)
    ELSE json_object('flat', flat, 'randomN', n)
  END
FROM vals68;

-- A base roll: its text goes, the Gold Axe's switch becomes `strengthHalf`, a null roll becomes 0.
INSERT INTO edits68 (doc_id, path, kind, val)
SELECT doc_id, fullkey || '.expr', 'remove', NULL FROM objs68
WHERE json_type(v, '$.expr') IS NOT NULL AND json_type(v, '$.flat') IS NOT NULL;
INSERT INTO edits68 (doc_id, path, kind, val)
SELECT doc_id, fullkey || '.extra', 'remove', NULL FROM objs68
WHERE json_type(v, '$.extra') IS NOT NULL AND json_type(v, '$.flat') IS NOT NULL;
-- The Strength roll: only a base row's (`attPower.base`), and only where `extra` was set.
INSERT INTO edits68 (doc_id, path, kind, val)
SELECT doc_id, fullkey || '.strengthHalf', 'set', 'true' FROM objs68
WHERE path GLOB '*.base' AND json_type(v, '$.flat') IS NOT NULL
  AND json_type(v, '$.extra') = 'text' AND json_extract(v, '$.extra') <> '';
INSERT INTO edits68 (doc_id, path, kind, val)
SELECT doc_id, fullkey || '.randomN', 'set', '0' FROM objs68
WHERE json_type(v, '$.expr') IS NOT NULL AND json_type(v, '$.randomN') = 'null';
-- A roll of 0 or below drew once and gave 0: `random(1)` draws once and gives 1, so `flat` is one
-- lower.
INSERT INTO edits68 (doc_id, path, kind, val)
SELECT doc_id, fullkey || '.randomN', 'set', '1' FROM objs68
WHERE json_type(v, '$.expr') IS NOT NULL AND json_type(v, '$.randomN') = 'integer'
  AND json_extract(v, '$.randomN') <= 0;
INSERT INTO edits68 (doc_id, path, kind, val)
SELECT doc_id, fullkey || '.flat', 'set', CAST(json_extract(v, '$.flat') - 1 AS TEXT) FROM objs68
WHERE json_type(v, '$.expr') IS NOT NULL AND json_type(v, '$.randomN') = 'integer'
  AND json_extract(v, '$.randomN') <= 0 AND json_type(v, '$.flat') = 'integer';
-- A publish entry whose rows changed shape works its pack row's hash out again when read.
INSERT INTO edits68 (doc_id, path, kind, val)
SELECT d.doc_id, '$.' || s.side || '.baseHash', 'set', 'null'
FROM docs68 d, (SELECT 'before' AS side UNION ALL SELECT 'after') s
WHERE d.target = 'pub'
  AND json_type(d.doc, '$.' || s.side || '.baseData') IN ('object', 'array')
  AND EXISTS (SELECT 1 FROM edits68 e WHERE e.doc_id = d.doc_id);

-- Apply each document's edits in turn.
CREATE TEMP TABLE res68 (doc_id INTEGER PRIMARY KEY, doc TEXT NOT NULL);
INSERT INTO res68 (doc_id, doc)
WITH RECURSIVE
  e AS (SELECT doc_id, path, kind, val, row_number() OVER (PARTITION BY doc_id ORDER BY path, kind) AS seq FROM edits68),
  ap(doc_id, seq, doc) AS (
    SELECT doc_id, 0, doc FROM docs68 WHERE doc_id IN (SELECT doc_id FROM edits68)
    UNION ALL
    SELECT ap.doc_id, e.seq,
      CASE e.kind WHEN 'remove' THEN json_remove(ap.doc, e.path) ELSE json_set(ap.doc, e.path, json(e.val)) END
    FROM ap JOIN e ON e.doc_id = ap.doc_id AND e.seq = ap.seq + 1
  )
SELECT doc_id, doc FROM ap a WHERE seq = (SELECT max(seq) FROM ap b WHERE b.doc_id = a.doc_id);

UPDATE content_packs
SET data = json_set(data, '$.data.attpower',
  json((SELECT r.doc FROM docs68 d JOIN res68 r USING (doc_id)
        WHERE d.target = 'pack' AND d.k1 = content_packs.id AND d.col = '$.data.attpower')))
WHERE EXISTS (SELECT 1 FROM docs68 d JOIN res68 r USING (doc_id)
              WHERE d.target = 'pack' AND d.k1 = content_packs.id AND d.col = '$.data.attpower');
UPDATE content_packs
SET data = json_set(data, '$.data.spells',
  json((SELECT r.doc FROM docs68 d JOIN res68 r USING (doc_id)
        WHERE d.target = 'pack' AND d.k1 = content_packs.id AND d.col = '$.data.spells')))
WHERE EXISTS (SELECT 1 FROM docs68 d JOIN res68 r USING (doc_id)
              WHERE d.target = 'pack' AND d.k1 = content_packs.id AND d.col = '$.data.spells');
UPDATE content_rows
SET data = (SELECT r.doc FROM docs68 d JOIN res68 r USING (doc_id)
            WHERE d.target = 'row' AND d.col = 'data' AND d.k1 = content_rows.dataset
              AND d.k2 = content_rows.part AND d.k3 = content_rows.row_key)
WHERE EXISTS (SELECT 1 FROM docs68 d JOIN res68 r USING (doc_id)
              WHERE d.target = 'row' AND d.col = 'data' AND d.k1 = content_rows.dataset
                AND d.k2 = content_rows.part AND d.k3 = content_rows.row_key);
UPDATE content_rows
SET base_data = (SELECT r.doc FROM docs68 d JOIN res68 r USING (doc_id)
                 WHERE d.target = 'row' AND d.col = 'base_data' AND d.k1 = content_rows.dataset
                   AND d.k2 = content_rows.part AND d.k3 = content_rows.row_key),
    base_hash = NULL
WHERE EXISTS (SELECT 1 FROM docs68 d JOIN res68 r USING (doc_id)
              WHERE d.target = 'row' AND d.col = 'base_data' AND d.k1 = content_rows.dataset
                AND d.k2 = content_rows.part AND d.k3 = content_rows.row_key);
UPDATE content_draft
SET data = (SELECT r.doc FROM docs68 d JOIN res68 r USING (doc_id)
            WHERE d.target = 'draft' AND d.k1 = content_draft.dataset
              AND d.k2 = content_draft.part AND d.k3 = content_draft.row_key)
WHERE EXISTS (SELECT 1 FROM docs68 d JOIN res68 r USING (doc_id)
              WHERE d.target = 'draft' AND d.k1 = content_draft.dataset
                AND d.k2 = content_draft.part AND d.k3 = content_draft.row_key);
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(coalesce(
    (SELECT r.doc FROM docs68 d JOIN res68 r USING (doc_id)
     WHERE d.target = 'pub' AND d.k1 = content_publishes.id AND d.k2 = CAST(c.key AS TEXT)),
    c.value)))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (SELECT 1 FROM docs68 d JOIN res68 r USING (doc_id)
              WHERE d.target = 'pub' AND d.k1 = content_publishes.id);

DROP TABLE docs68;
DROP TABLE objs68;
DROP TABLE edits68;
DROP TABLE res68;

-- A tier value nothing above could read stops the upgrade with this table's name in the error,
-- rather than a world that will not load: fix the row (or remove it) on the old version and upgrade
-- again. It is the last statement on purpose: a multi-statement run reports only the last
-- statement's error, and the whole migration then rolls back.
CREATE TEMP TABLE unreadable_attack_power_value_68 (value TEXT NOT NULL);
INSERT INTO unreadable_attack_power_value_68 (value) SELECT NULL FROM vals68 WHERE ok IS NULL;
