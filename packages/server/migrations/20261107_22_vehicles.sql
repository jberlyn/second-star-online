-- The Airship. `characters.vehicle` is what a player is riding (only 'Airship'; 1.6 kept it in the
-- `Vehicle` TempSave field), and `ground_items.owner_id` is the character who built or parked a
-- parked Airship, so boarding compares ids, not name text (the server converts vehicles). No
-- foreign key: a deleted character's airship stays as a fixture nobody can board, as in 1.6 once
-- the name is gone.
ALTER TABLE characters ADD COLUMN vehicle TEXT CHECK (vehicle IN ('Airship'));
ALTER TABLE ground_items ADD COLUMN owner_id TEXT;
