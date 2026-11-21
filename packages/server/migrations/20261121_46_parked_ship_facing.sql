-- A parked Boat or Battleship keeps the way it faced when it was left ('N', 'S', 'E' or 'W'), and
-- its rider takes that facing on boarding. NULL (every other item, and ships parked before this)
-- faces east, as the docked picture does.
ALTER TABLE ground_items ADD COLUMN facing TEXT CHECK (facing IS NULL OR facing IN ('N', 'S', 'E', 'W'));
