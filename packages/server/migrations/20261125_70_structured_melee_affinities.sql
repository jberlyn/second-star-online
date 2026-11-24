-- Structured melee affinities (#31 stage 1). A monsters.json `meleeAffinities` row's extra roll was
-- text, `deltaRandom: "random(n)"` or null; it is now a part, `randomN: n`, as the balance amounts
-- and attack power are (0 rolls nothing).
--
-- It plays exactly as before. The old reader added `random(first digits)` for any non-empty text:
--   - null, missing or empty text drew nothing: 0;
--   - `random(n)` with n of 1 or more drew `random(n)`: n, leading zeros dropped and any size kept
--     (written as the same number literal, so it reads back as the very number the old reader drew;
--     up to the largest finite number: one that reads as Infinity, 2^1024 - 2^970 or more, no row
--     can hold, so it stops the upgrade);
--   - `random(0)`, or text of only spaces, drew once and gave 0: `random(1)` (always 1) with `delta`
--     one lower, which the schema allows down to -2^53 for exactly this.
-- Spaces around `random`, the brackets and the digits are allowed; anything else (`random(1 2)`,
-- `2+random(3)`, `banana`) stops the upgrade, naming this migration, rather than guessing.
--
-- Every stored copy of the monsters dataset gets the new shape: an imported pack's, the operator's
-- rows and the pack rows they were made over (whose hash is then worked out when read, so an
-- unchanged pack row raises no notice), the draft's, and the rows the publish log keeps for undo.
-- Only the `meleeAffinities` part holds affinity rows (objects with `monsterMatch`), and only they
-- are touched, and each array holding them is
-- rebuilt once, in order. Running it again changes nothing.

CREATE TEMP TABLE docs70 (
  doc_id INTEGER PRIMARY KEY,
  target TEXT NOT NULL,
  k1 TEXT,
  k2 TEXT,
  k3 TEXT,
  col TEXT NOT NULL,
  doc TEXT NOT NULL
);
INSERT INTO docs70 (target, k1, col, doc)
SELECT 'pack', id, '$.data.monsters', json_extract(data, '$.data.monsters')
FROM content_packs
WHERE data IS NOT NULL AND json_type(data, '$.data.monsters') = 'object';
INSERT INTO docs70 (target, k1, k2, k3, col, doc)
SELECT 'row', dataset, part, row_key, 'data', data FROM content_rows
WHERE dataset = 'monsters' AND part = 'meleeAffinities' AND json_type(data) IN ('object', 'array');
INSERT INTO docs70 (target, k1, k2, k3, col, doc)
SELECT 'row', dataset, part, row_key, 'base_data', base_data FROM content_rows
WHERE dataset = 'monsters' AND part = 'meleeAffinities' AND json_type(base_data) IN ('object', 'array');
INSERT INTO docs70 (target, k1, k2, k3, col, doc)
SELECT 'draft', dataset, part, row_key, 'data', data FROM content_draft
WHERE dataset = 'monsters' AND part = 'meleeAffinities' AND json_type(data) IN ('object', 'array');
INSERT INTO docs70 (target, k1, k2, col, doc)
SELECT 'pub', p.id, c.key, 'change', c.value
FROM content_publishes p, json_each(p.changes) c
WHERE json_extract(c.value, '$.dataset') = 'monsters'
  AND json_extract(c.value, '$.part') = 'meleeAffinities';
-- The writes below look documents up by where they came from.
CREATE INDEX docs70_from ON docs70 (target, k1, k2, k3);

-- Every affinity row of every document, read once, with where it sits: its container's path and
-- its key there (none for a document that is itself one row).
CREATE TEMP TABLE rows70 (doc_id INTEGER NOT NULL, path TEXT NOT NULL, k, isroot INTEGER NOT NULL,
  v TEXT NOT NULL, typ TEXT, raw TEXT, s TEXT, rest TEXT, inner TEXT, digits TEXT,
  ok INTEGER, zero INTEGER, newv TEXT);
INSERT INTO rows70 (doc_id, path, k, isroot, v, typ, raw)
SELECT d.doc_id, o.path, o.key, o.parent IS NULL, o.value, json_type(o.value, '$.deltaRandom'),
  CASE json_type(o.value, '$.deltaRandom') WHEN 'text' THEN json_extract(o.value, '$.deltaRandom') END
FROM docs70 d, json_tree(d.doc) o
WHERE o.type = 'object' AND json_type(o.value, '$.monsterMatch') IS NOT NULL
  AND json_type(o.value, '$.randomN') IS NULL;
CREATE INDEX rows70_at ON rows70 (doc_id, path, k);
-- No roll: null, missing or empty text.
UPDATE rows70 SET ok = 1, zero = 0 WHERE typ IS NULL OR typ = 'null' OR raw = '';
-- The tokens, spaces round each allowed: `random`, `(`, digits, `)`.
UPDATE rows70 SET s = trim(raw, ' ' || char(9) || char(10) || char(13)) WHERE ok IS NULL AND typ = 'text';
-- Only spaces: the old reader drew `random(NaN)`, which drew once and gave 0.
UPDATE rows70 SET ok = 1, zero = 1 WHERE ok IS NULL AND s = '';
UPDATE rows70 SET rest = ltrim(substr(s, 7), ' ' || char(9) || char(10) || char(13))
WHERE ok IS NULL AND substr(s, 1, 6) = 'random';
UPDATE rows70 SET inner = trim(substr(rest, 2, length(rest) - 2), ' ' || char(9) || char(10) || char(13))
WHERE ok IS NULL AND length(rest) >= 2 AND substr(rest, 1, 1) = '(' AND substr(rest, -1) = ')';
UPDATE rows70 SET digits = ltrim(inner, '0')
WHERE ok IS NULL AND inner <> '' AND inner NOT GLOB '*[^0-9]*';
UPDATE rows70 SET ok = 1, zero = 1 WHERE ok IS NULL AND digits = '';
-- Below 2^1024 - 2^970 (309 digits) a number reads as a finite one; from there it reads as Infinity.
UPDATE rows70 SET ok = 1, zero = 0 WHERE ok IS NULL AND (length(digits) BETWEEN 1 AND 308
  OR (length(digits) = 309 AND digits < '179769313486231580793728971405303415079934132710037826936173778980444968292764750946649017977587207096330286416692887910946555547851940402630657488671505820681908902000708383676273854845817711531764475730270069855571366959622842914819860834936475292719074168444365510704342711559699508093042880177904174497792'));

-- Each readable row's new shape.
UPDATE rows70 SET newv = CASE
  WHEN zero = 1 AND json_type(v, '$.delta') = 'integer'
    THEN json_set(json_remove(v, '$.deltaRandom'), '$.randomN', 1, '$.delta', json_extract(v, '$.delta') - 1)
  WHEN zero = 1 THEN json_set(json_remove(v, '$.deltaRandom'), '$.randomN', 1)
  ELSE json_set(json_remove(v, '$.deltaRandom'), '$.randomN', json(coalesce(digits, '0')))
END
WHERE ok = 1;

-- Each container holding readable rows, rebuilt once with its other members as they were.
CREATE TEMP TABLE parts70 (doc_id INTEGER NOT NULL, path TEXT NOT NULL, val TEXT,
  PRIMARY KEY (doc_id, path));
INSERT INTO parts70 (doc_id, path)
SELECT DISTINCT doc_id, path FROM rows70 WHERE ok = 1 AND isroot = 0;
UPDATE parts70 SET val = (
  SELECT CASE json_type(d.doc, parts70.path)
    WHEN 'array' THEN (
      SELECT json_group_array(CASE
        WHEN r.newv IS NOT NULL THEN json(r.newv)
        WHEN e.type IN ('object', 'array', 'true', 'false', 'null') THEN json(CASE e.type
          WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' ELSE e.value END)
        ELSE e.value END ORDER BY e.id)
      FROM json_each(d.doc, parts70.path) e
      LEFT JOIN rows70 r ON r.doc_id = parts70.doc_id AND r.path = parts70.path AND r.k = e.key AND r.ok = 1)
    ELSE (
      SELECT json_group_object(e.key, CASE
        WHEN r.newv IS NOT NULL THEN json(r.newv)
        WHEN e.type IN ('object', 'array', 'true', 'false', 'null') THEN json(CASE e.type
          WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' ELSE e.value END)
        ELSE e.value END ORDER BY e.id)
      FROM json_each(d.doc, parts70.path) e
      LEFT JOIN rows70 r ON r.doc_id = parts70.doc_id AND r.path = parts70.path AND r.k = e.key AND r.ok = 1)
  END
  FROM docs70 d WHERE d.doc_id = parts70.doc_id);

-- Each document with its containers put back (a document holds one or a few), or the row itself.
CREATE TEMP TABLE res70 (doc_id INTEGER PRIMARY KEY, doc TEXT NOT NULL);
INSERT INTO res70 (doc_id, doc)
WITH RECURSIVE
  e AS (SELECT doc_id, path, val, row_number() OVER (PARTITION BY doc_id ORDER BY path) AS seq FROM parts70),
  ap(doc_id, seq, doc) AS (
    SELECT doc_id, 0, doc FROM docs70 WHERE doc_id IN (SELECT doc_id FROM parts70)
    UNION ALL
    SELECT ap.doc_id, e.seq, json_set(ap.doc, e.path, json(e.val))
    FROM ap JOIN e ON e.doc_id = ap.doc_id AND e.seq = ap.seq + 1
  ),
  last AS (SELECT doc_id, doc, seq, max(seq) OVER (PARTITION BY doc_id) AS top FROM ap)
SELECT doc_id, doc FROM last WHERE seq = top;
INSERT INTO res70 (doc_id, doc)
SELECT doc_id, newv FROM rows70 WHERE ok = 1 AND isroot = 1;
-- A publish entry whose rows changed shape works its pack row's hash out again when read.
UPDATE res70 SET doc = json_set(doc, '$.before.baseHash', json('null'))
WHERE doc_id IN (SELECT doc_id FROM docs70 WHERE target = 'pub')
  AND json_type(doc, '$.before.baseData') IN ('object', 'array');
UPDATE res70 SET doc = json_set(doc, '$.after.baseHash', json('null'))
WHERE doc_id IN (SELECT doc_id FROM docs70 WHERE target = 'pub')
  AND json_type(doc, '$.after.baseData') IN ('object', 'array');

UPDATE content_packs
SET data = json_set(data, '$.data.monsters',
  json((SELECT r.doc FROM docs70 d JOIN res70 r USING (doc_id)
        WHERE d.target = 'pack' AND d.k1 = content_packs.id)))
WHERE EXISTS (SELECT 1 FROM docs70 d JOIN res70 r USING (doc_id)
              WHERE d.target = 'pack' AND d.k1 = content_packs.id);
UPDATE content_rows
SET data = (SELECT r.doc FROM docs70 d JOIN res70 r USING (doc_id)
            WHERE d.target = 'row' AND d.col = 'data' AND d.k1 = content_rows.dataset
              AND d.k2 = content_rows.part AND d.k3 = content_rows.row_key)
WHERE EXISTS (SELECT 1 FROM docs70 d JOIN res70 r USING (doc_id)
              WHERE d.target = 'row' AND d.col = 'data' AND d.k1 = content_rows.dataset
                AND d.k2 = content_rows.part AND d.k3 = content_rows.row_key);
UPDATE content_rows
SET base_data = (SELECT r.doc FROM docs70 d JOIN res70 r USING (doc_id)
                 WHERE d.target = 'row' AND d.col = 'base_data' AND d.k1 = content_rows.dataset
                   AND d.k2 = content_rows.part AND d.k3 = content_rows.row_key),
    base_hash = NULL
WHERE EXISTS (SELECT 1 FROM docs70 d JOIN res70 r USING (doc_id)
              WHERE d.target = 'row' AND d.col = 'base_data' AND d.k1 = content_rows.dataset
                AND d.k2 = content_rows.part AND d.k3 = content_rows.row_key);
UPDATE content_draft
SET data = (SELECT r.doc FROM docs70 d JOIN res70 r USING (doc_id)
            WHERE d.target = 'draft' AND d.k1 = content_draft.dataset
              AND d.k2 = content_draft.part AND d.k3 = content_draft.row_key)
WHERE EXISTS (SELECT 1 FROM docs70 d JOIN res70 r USING (doc_id)
              WHERE d.target = 'draft' AND d.k1 = content_draft.dataset
                AND d.k2 = content_draft.part AND d.k3 = content_draft.row_key);
UPDATE content_publishes
SET changes = (
  SELECT json_group_array(json(coalesce(
    (SELECT r.doc FROM docs70 d JOIN res70 r USING (doc_id)
     WHERE d.target = 'pub' AND d.k1 = content_publishes.id AND d.k2 = CAST(c.key AS TEXT)),
    c.value)))
  FROM (SELECT key, value FROM json_each(content_publishes.changes) ORDER BY key) c
)
WHERE EXISTS (SELECT 1 FROM docs70 d JOIN res70 r USING (doc_id)
              WHERE d.target = 'pub' AND d.k1 = content_publishes.id);

-- A roll nothing above could read stops the upgrade with this table's name in the error, rather
-- than a world that will not load: fix the row (or remove it) on the old version and upgrade again.
-- The failing statement rolls the whole migration back.
CREATE TEMP TABLE unreadable_melee_affinity_roll_70 (value TEXT NOT NULL);
INSERT INTO unreadable_melee_affinity_roll_70 (value) SELECT NULL FROM rows70 WHERE ok IS NULL;

DROP TABLE unreadable_melee_affinity_roll_70;
DROP TABLE docs70;
DROP TABLE rows70;
DROP TABLE parts70;
DROP TABLE res70;
