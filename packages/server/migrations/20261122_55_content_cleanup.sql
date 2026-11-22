-- What removing content in use does to the world (issue #28). Removing an item or a monster from
-- the Content page puts its cleanup in the draft with it: the content rows it changes are ordinary
-- draft rows, and what happens to the world (copies players hold, spawns, live monsters) waits
-- here, one row per removed entry, until the draft is published. `action` is JSON.
CREATE TABLE content_draft_actions (
  kind TEXT NOT NULL CHECK (kind IN ('item', 'monster')),
  entry_key TEXT NOT NULL,
  action TEXT NOT NULL,
  author_account_id TEXT NOT NULL,
  author TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, entry_key)
);

-- What a publish did to the world, as JSON: the actions and a line per thing done. Empty for a
-- publish with no world cleanup. An undo puts the content rows back but not the world.
ALTER TABLE content_publishes ADD COLUMN cleanup TEXT;
