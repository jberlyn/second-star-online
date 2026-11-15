-- Named containers: 1.6 kept each in its own text file (other than the personal vault), one item
-- name per line, in order. Keyed by the container's full name with its id: `Cauldron#<n>` (the
-- World Editor's), a carried `Crate#<n>`, `Cabinet#<n>`, `Wind Cabinet#<n>` or `Cauldron#<n>`.
-- Later migrations add the house, guild and quest containers to the same table.
CREATE TABLE container_items (
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  item TEXT NOT NULL,
  PRIMARY KEY (name, position)
);
