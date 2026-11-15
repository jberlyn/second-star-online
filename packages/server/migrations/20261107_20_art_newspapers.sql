-- Paintings, photos and newspapers. 1.6 kept art as an image file (`writevalue`) with a text file
-- for the author and a newspaper as a text file per author. SSO keeps rows. Nothing is imported:
-- the archive's art and newspaper folders are empty.

-- One row per saved painting or photo. The id is `random(10000000)` as in 1.6, retried
-- until unused. Rows are never deleted: 1.6 never deleted art, so an item that is lost
-- or destroyed leaves its art behind.
CREATE TABLE art (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('painting', 'photo')),
  -- Stamped by the server from the saving character, never typed.
  author TEXT NOT NULL,
  png BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- One newspaper per author, matched ignoring case (1.6 kept one file per name, and Windows file
-- names ignore case). Only an immortal writes one (1.6 let anyone). Photo fields are art ids as
-- typed.
CREATE TABLE newspapers (
  author TEXT PRIMARY KEY COLLATE NOCASE,
  photo1 TEXT NOT NULL,
  photo2 TEXT NOT NULL,
  photo3 TEXT NOT NULL,
  text1 TEXT NOT NULL,
  text2 TEXT NOT NULL,
  text3 TEXT NOT NULL,
  text4 TEXT NOT NULL,
  text5 TEXT NOT NULL,
  text6 TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
