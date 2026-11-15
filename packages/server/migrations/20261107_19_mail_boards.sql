-- Mail and message boards. 1.6 kept a mailbox as a text file (`from*subject*body|…`) and a board as
-- a text file (the whole board, rewritten by each post). SSO keeps rows. Nothing is imported: the
-- archive's mail and board folders hold no files.

-- One row per message in a character's mailbox. The id grows, so oldest first is id order; the
-- server cuts a box to `mailboxMax` after each insert. Deleting the character deletes its mail.
CREATE TABLE mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  -- Stamped by the server from the sender's character, never typed (1.6 trusted the sender name).
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL
);
CREATE INDEX mail_owner ON mail (owner_id, id);

-- One row per post. A board is Town Square or a hall's `<item name>` (`The Knights's Board`),
-- compared ignoring case (1.6 kept one file per name, and Windows file names ignore case). Posts
-- are append-only (1.6 let any client overwrite a board); the server cuts a board to
-- `boardPostsMax`.
CREATE TABLE board_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL COLLATE NOCASE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  posted_at TEXT NOT NULL
);
CREATE INDEX board_posts_board ON board_posts (board, id);
