-- The jail and the church bell become settings (#37 stage 2). 1.6 hard-coded both: /jail sent a
-- player to x0y0 (4, 4), and the bell rang on x999y999. Every server up to now runs Classic, so
-- each keeps those: the jail point is saved as it was, and the bell map (which has no default) is
-- set to x999y999. An operator's own value is kept. Running it again changes nothing.
INSERT INTO settings (key, value, updated_at)
VALUES ('jailPoint', '{"map":"x0y0","x":4,"y":4}', '2026-11-23T00:00:00.000Z')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value, updated_at)
VALUES ('bellMap', '"x999y999"', '2026-11-23T00:00:00.000Z')
ON CONFLICT(key) DO NOTHING;

-- bindings.json gains the currency, the start, the cannon and the bodies, each a section a pack
-- must supply. An imported pack was made when the engine named these itself, so it gets the values
-- the engine used then (Classic's), and plays as it did.
UPDATE content_packs
SET data = json_set(data,
  '$.data.bindings.currency', json(coalesce(json_extract(data, '$.data.bindings.currency'),
    '{"item":"Gold"}')),
  '$.data.bindings.start', json(coalesce(json_extract(data, '$.data.bindings.start'),
    '{"hp":20,"sp":20,"bag":[{"item":"Apple","qty":2},{"item":"Knife","qty":1}]}')),
  '$.data.bindings.cannon', json(coalesce(json_extract(data, '$.data.bindings.cannon'),
    '{"ammo":"Cannonball"}')),
  '$.data.bindings.bodies', json(coalesce(json_extract(data, '$.data.bindings.bodies'),
    '{"morph":[{"above":0,"body":30},{"above":10,"body":32},{"above":13,"body":31},{"above":16,"body":33},{"above":19,"body":37},{"above":21,"body":34},{"above":23,"body":41},{"above":24,"body":40}],"tree":80,"smoke":100,"riders":{"Boat":55,"Battleship":56,"Airship":57}}'))
)
WHERE source = 'imported' AND json_type(data, '$.data.bindings') = 'object';
