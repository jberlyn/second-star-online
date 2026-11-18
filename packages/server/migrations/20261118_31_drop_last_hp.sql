-- A species with no hit point entry now spawns with the Generic member's hit points, not the HP
-- the slot's last occupant died with, so the slot no longer keeps that value.
ALTER TABLE map_slots DROP COLUMN last_hp;
