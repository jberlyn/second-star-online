-- The skill indices characters are saved with (issue #27). A character's skills are a list read
-- by each skill's index, so once a skill has been live its index may never change. The server
-- records every live skill here, and refuses to start when the packs and operator changes would
-- move one (a release that reorders the skills), instead of shifting every character's training
-- onto other skills. Filled in at the first start after this migration.
CREATE TABLE content_skills (
  skill TEXT PRIMARY KEY,
  idx INTEGER NOT NULL
);
