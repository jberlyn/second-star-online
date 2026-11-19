-- The on/off dropOnDeath setting becomes deathDrops, a choice of whose deaths drop (Off, Wanted
-- only, Killed by a player or Everyone). An operator who had turned drops off keeps them off;
-- anything else takes the new default, Wanted only.
INSERT OR REPLACE INTO settings (key, value, updated_at)
  SELECT 'deathDrops', '"off"', updated_at FROM settings WHERE key = 'dropOnDeath' AND value = 'false';
DELETE FROM settings WHERE key = 'dropOnDeath';
