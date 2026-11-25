-- House changes from the player hub (issue #36): a revoke (a demolition, which cannot be undone)
-- and a transfer (undone by transferring the house back) are kept in the character editor's log
-- beside the editor's own saves. `kind` says which a row is (`edit`, `houseRevoke` or
-- `houseTransfer`); `summary` says what a house change destroyed or moved; `irreversible` marks a
-- row nothing can undo. The hub offers undo only for `edit` rows.
ALTER TABLE character_edits ADD COLUMN kind TEXT NOT NULL DEFAULT 'edit';
ALTER TABLE character_edits ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE character_edits ADD COLUMN irreversible INTEGER NOT NULL DEFAULT 0;
