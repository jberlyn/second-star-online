-- Houses are named by their interior, not by owner and outdoor map, so two houses one owner builds
-- on the same map each keep their own blueprint. The house list names the house it stands for and
-- records the month with its year (`YYYY-MM`) so a house seen a year ago no longer counts as fresh.
CREATE TABLE houses_new (
  owner_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  map_name TEXT NOT NULL,
  item1 TEXT NOT NULL,
  item2 TEXT NOT NULL,
  tiles TEXT NOT NULL,
  interior TEXT NOT NULL PRIMARY KEY,
  updated_at TEXT NOT NULL
);
INSERT INTO houses_new (owner_id, map_name, item1, item2, tiles, interior, updated_at)
  SELECT owner_id, map_name, item1, item2, tiles, interior, updated_at FROM houses;
DROP TABLE houses;
ALTER TABLE houses_new RENAME TO houses;

-- A Small Shop's street lamp was recorded one row above where it stands; record where it stands.
UPDATE houses
  SET item1 = json_set(item1, '$.y', json_extract(item1, '$.y') + 1)
  WHERE item1 <> '' AND json_extract(item1, '$.item') = 'Street Lamp';

ALTER TABLE house_list ADD COLUMN interior TEXT NOT NULL DEFAULT '';
UPDATE house_list
  SET interior = COALESCE(
    (SELECT h.interior FROM houses h
      WHERE h.owner_id = house_list.owner_id AND h.map_name = house_list.map_name),
    '');

-- A bare month (1-12) becomes this year's, or last year's when it is later than this month.
UPDATE house_list
  SET month = (
      CASE WHEN CAST(month AS INTEGER) <= CAST(strftime('%m', 'now') AS INTEGER)
        THEN strftime('%Y', 'now')
        ELSE CAST(CAST(strftime('%Y', 'now') AS INTEGER) - 1 AS TEXT)
      END
    ) || '-' || printf('%02d', CAST(month AS INTEGER))
  WHERE CAST(month AS INTEGER) BETWEEN 1 AND 12 AND month NOT LIKE '%-%';
