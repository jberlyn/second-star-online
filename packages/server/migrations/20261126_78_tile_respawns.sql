-- Harvest nodes may come back on a timer (`harvest[].respawn`): each used-up node's tile waits
-- here until it is due, so a restart does not leave it spent. Written with the map's tiles.
CREATE TABLE tile_respawns (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  tile TEXT NOT NULL,
  becomes TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  PRIMARY KEY (map_id, x, y)
);
