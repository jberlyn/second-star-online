-- A death no longer lowers maximum HP or SP. Both start at 20 and only a level raises them (+1
-- each), so a character never weakened has 19 + level; give back what the old penalty took. A
-- promotion can raise SP above that, and an operator may have set either higher, so nothing is
-- lowered.
UPDATE characters SET hp_max = 19 + level WHERE hp_max < 19 + level;
UPDATE characters SET sp_max = 19 + level WHERE sp_max < 19 + level;
