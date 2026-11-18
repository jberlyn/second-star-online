-- A class's stat points are no longer added to the stored stats at promotion: they are the
-- class's `statBonus` in classes.json, added while a character is in the class, so classes can be
-- rebalanced. Take the shipped promotion points of each character's current class back off the
-- stored stats (never below 1). No class with points is a step toward another, so the current
-- class's points are the only ones stored.
UPDATE characters SET dex = MAX(1, dex - 3), wis = MAX(1, wis - 3), int = MAX(1, int - 3) WHERE class_code = 11; -- Druid
UPDATE characters SET wis = MAX(1, wis - 1) WHERE class_code = 19; -- Bard
UPDATE characters SET str = MAX(1, str - 1) WHERE class_code = 20; -- Barbarian
