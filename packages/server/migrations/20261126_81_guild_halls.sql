-- A guild hall belongs to its guild by id, not by the name on its door and vault (issue #16).
-- Empty for a house of a player. Halls built before this are matched to their guild at the next
-- start, by the vault in the hall; a hall whose guild is gone or disbanded is demolished then.
ALTER TABLE houses ADD COLUMN guild_id TEXT NOT NULL DEFAULT '';
