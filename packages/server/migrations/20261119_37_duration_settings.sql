-- Every duration setting is now set as time and stored in whole seconds, and its key no longer
-- names a unit. Each stored override moves to its new key in seconds: frames are 1/20 s (rounded
-- to the nearest second, but a wait that was on stays at least 1 s), milliseconds round to the
-- nearest second, and minutes and days convert exactly. A value that was not a number is dropped;
-- the setting goes back to its default, as the loader already did for it.
CREATE TEMP TABLE duration_settings (old_key TEXT PRIMARY KEY, new_key TEXT NOT NULL, unit TEXT NOT NULL);
INSERT INTO duration_settings (old_key, new_key, unit) VALUES
  ('saveIntervalTicks', 'saveInterval', 'frames'),
  ('broadcastCooldownFrames', 'broadcastCooldown', 'frames'),
  ('chatCooldownFrames', 'chatCooldown', 'frames'),
  ('resumeGraceMs', 'resumeGrace', 'ms'),
  ('npcChatterSeconds', 'npcChatter', 'seconds'),
  ('lootDecayMinutes', 'lootDecay', 'minutes'),
  ('jailMinutes', 'jailSentence', 'minutes'),
  ('banMinutes', 'banLength', 'minutes'),
  ('ipBanMinutes', 'ipBanLength', 'minutes'),
  ('addressHistoryDays', 'addressHistory', 'days'),
  ('chatLogRetentionDays', 'chatLogRetention', 'days'),
  ('auditLogRetentionDays', 'auditLogRetention', 'days');

INSERT INTO settings (key, value, updated_at)
SELECT d.new_key,
  CAST(
    CASE d.unit
      WHEN 'frames' THEN CASE
        WHEN CAST(s.value AS REAL) <= 0 THEN 0
        ELSE MAX(1, CAST(round(CAST(s.value AS REAL) / 20.0) AS INTEGER))
      END
      WHEN 'ms' THEN CAST(round(CAST(s.value AS REAL) / 1000.0) AS INTEGER)
      WHEN 'seconds' THEN CAST(s.value AS INTEGER)
      WHEN 'minutes' THEN CAST(s.value AS INTEGER) * 60
      WHEN 'days' THEN CAST(s.value AS INTEGER) * 86400
    END AS TEXT),
  s.updated_at
FROM settings s JOIN duration_settings d ON d.old_key = s.key
WHERE json_valid(s.value) AND json_type(s.value) IN ('integer', 'real')
ON CONFLICT(key) DO NOTHING;

DELETE FROM settings WHERE key IN (SELECT old_key FROM duration_settings);
DROP TABLE duration_settings;
