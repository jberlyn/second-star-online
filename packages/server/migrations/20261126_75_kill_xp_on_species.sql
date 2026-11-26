-- A monster's fixed kill XP is its species row's `killXp` (issue #42): the name-matched table
-- `monsters.rules.killXp` and a monster definition's `killXp` are gone. The move runs as code
-- (persistence/kill-xp-content.ts), layer by layer, so every monster gives the kill XP it gave
-- before. This statement only marks the step.
SELECT 1;
