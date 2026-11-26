-- A removal waiting in the draft may be a class's (issue #15): its characters move to another
-- class when it is published.
CREATE TABLE content_draft_actions_new (
  kind TEXT NOT NULL CHECK (kind IN ('item', 'monster', 'vehicle', 'class')),
  entry_key TEXT NOT NULL,
  action TEXT NOT NULL,
  author_account_id TEXT NOT NULL,
  author TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, entry_key)
);
INSERT INTO content_draft_actions_new (kind, entry_key, action, author_account_id, author, updated_at)
  SELECT kind, entry_key, action, author_account_id, author, updated_at FROM content_draft_actions;
DROP TABLE content_draft_actions;
ALTER TABLE content_draft_actions_new RENAME TO content_draft_actions;
