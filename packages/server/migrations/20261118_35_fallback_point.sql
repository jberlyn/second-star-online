-- Respawn and fallback points. The Respawn point setting becomes the Fallback map: only where a
-- character goes when their place is gone. Every character now has a respawn point (new ones get
-- the starting map), so a character without one is given the old setting's tile, which is where
-- their next death would have sent them. A setting map that does not exist leaves them without one,
-- and the fallback point covers them.
UPDATE settings SET key = 'fallbackPoint' WHERE key = 'respawnPoint';

UPDATE characters SET
  respawn_map_id = (
    SELECT m.id FROM maps m
    WHERE m.slot = 0
      AND 'x' || m.mx || 'y' || m.my = COALESCE(
        (SELECT json_extract(value, '$.map') FROM settings WHERE key = 'fallbackPoint'),
        'x1000y992'
      )
  ),
  respawn_x = COALESCE((SELECT json_extract(value, '$.x') FROM settings WHERE key = 'fallbackPoint'), 5),
  respawn_y = COALESCE((SELECT json_extract(value, '$.y') FROM settings WHERE key = 'fallbackPoint'), 5)
WHERE respawn_map_id IS NULL;

UPDATE characters SET respawn_x = NULL, respawn_y = NULL WHERE respawn_map_id IS NULL;
