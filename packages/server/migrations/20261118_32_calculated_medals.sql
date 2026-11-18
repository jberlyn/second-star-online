-- Medal stat points are no longer granted and stored: a character's stats are the points it
-- allocated, and each skill at 90 or more adds its medal's points while it stays there. Take the
-- points each held medal granted back off the stored stats (never below 1), then drop the field.
-- The ids and points are the medal table as shipped (packages/data/content/social.json).
UPDATE characters SET sta = MAX(1, sta - 1) WHERE '-' || medals LIKE '%-39-%'; -- Cooking
UPDATE characters SET dex = MAX(1, dex - 1) WHERE '-' || medals LIKE '%-31-%'; -- Magery
UPDATE characters SET sta = MAX(1, sta - 1) WHERE '-' || medals LIKE '%-94-%'; -- Parry
UPDATE characters SET str = MAX(1, str - 1) WHERE '-' || medals LIKE '%-95-%'; -- Slash
UPDATE characters SET str = MAX(1, str - 1) WHERE '-' || medals LIKE '%-93-%'; -- Mining
UPDATE characters SET int = MAX(1, int - 1) WHERE '-' || medals LIKE '%-35-%'; -- Fishing
UPDATE characters SET wis = MAX(1, wis - 1) WHERE '-' || medals LIKE '%-61-%'; -- Alchemy
UPDATE characters SET int = MAX(1, int - 1) WHERE '-' || medals LIKE '%-44-%'; -- Archery
UPDATE characters SET dex = MAX(1, dex - 1) WHERE '-' || medals LIKE '%-45-%'; -- Wizardry
UPDATE characters SET str = MAX(1, str - 1) WHERE '-' || medals LIKE '%-91-%'; -- Lumberjacking
UPDATE characters SET str = MAX(1, str - 2), sta = MAX(1, sta - 2) WHERE '-' || medals LIKE '%-92-%'; -- Blacksmithing
UPDATE characters SET sta = MAX(1, sta - 1), int = MAX(1, int - 3) WHERE '-' || medals LIKE '%-20-%'; -- Farming
UPDATE characters SET wis = MAX(1, wis - 1), int = MAX(1, int - 2), str = MAX(1, str - 1) WHERE '-' || medals LIKE '%-21-%'; -- MartialArts
UPDATE characters SET str = MAX(1, str - 2) WHERE '-' || medals LIKE '%-70-%'; -- Thrust
UPDATE characters SET str = MAX(1, str - 3), sta = MAX(1, sta - 2) WHERE '-' || medals LIKE '%-71-%'; -- Swordsmanship
UPDATE characters SET str = MAX(1, str - 2) WHERE '-' || medals LIKE '%-72-%'; -- HeavyArms
UPDATE characters SET wis = MAX(1, wis - 2) WHERE '-' || medals LIKE '%-73-%'; -- Block
UPDATE characters SET dex = MAX(1, dex - 2), int = MAX(1, int - 1) WHERE '-' || medals LIKE '%-74-%'; -- fire
UPDATE characters SET int = MAX(1, int - 1), wis = MAX(1, wis - 1) WHERE '-' || medals LIKE '%-75-%'; -- Carpentry
ALTER TABLE characters DROP COLUMN medals;
