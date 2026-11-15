-- Walk speed is no longer an operator setting (the actor phase runs twice per frame, as measured in
-- 1.6). Drop any stored value; the loader ignores unknown keys.
DELETE FROM settings WHERE key = 'stepFrames';
