-- The engine's own start, fallback and jail points change to the Minimal pack's (#37 stage 7):
-- x0y0 (1, 1) for the start and the fallback, x50y50 (1, 1) for the jail. A new world stores the
-- points of the pack it was created with, so these defaults only matter where nothing is stored.
-- Every server up to now runs Classic and stored no start or fallback point unless its operator
-- set one, so each keeps the points the engine gave it until now: x1000y992 (6, 4) and (5, 5). An
-- operator's own value is kept. The jail's was stored by migration 59. Running it again changes
-- nothing.
INSERT INTO settings (key, value, updated_at)
VALUES ('startPoint', '{"map":"x1000y992","x":6,"y":4}', '2026-11-24T00:00:00.000Z')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value, updated_at)
VALUES ('fallbackPoint', '{"map":"x1000y992","x":5,"y":5}', '2026-11-24T00:00:00.000Z')
ON CONFLICT(key) DO NOTHING;
