-- World counters (issue #3): each counter the world's content defines (`events.json`) keeps its
-- value here, by name, so an offering's change survives a restart. A counter content no longer
-- defines keeps its row, and has its value back if it is defined again.
CREATE TABLE world_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
