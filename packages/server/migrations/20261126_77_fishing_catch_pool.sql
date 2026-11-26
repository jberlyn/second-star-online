-- Fishing's catch table becomes a catch pool (`fishing.catches`: each fish a skill range and a
-- weight, with optional XP) and what a cast trains is content (`fishing.trains`). The move runs as
-- code (persistence/fishing-catch-content.ts), layer by layer, so every world catches and trains
-- as it did. This statement only marks the step.
SELECT 1;
