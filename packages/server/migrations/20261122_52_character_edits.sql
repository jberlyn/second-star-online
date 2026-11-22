-- The character editor's log (issue #26): every edit an admin makes in the player hub, with the
-- reason, and each field's value before and after (`changes`, a JSON list of
-- {field, before, after}), so an edit can be undone from it. Like the other logs, rows outlive the
-- characters and accounts they name (no foreign keys), and `id` is a UUIDv7 so rows sort in the
-- order they were made. An undo is an edit of its own: `undo_of` names the edit it undid, and
-- that edit's `undone_by` names the undo.
CREATE TABLE character_edits (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_account_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  character_id TEXT NOT NULL,
  character TEXT NOT NULL,
  reason TEXT NOT NULL,
  changes TEXT NOT NULL,
  -- 1 when the admin saved worn gear the wear rules refuse.
  override INTEGER NOT NULL DEFAULT 0,
  undo_of TEXT,
  undone_by TEXT
);
CREATE INDEX character_edits_by_character ON character_edits (character_id, created_at, id);
