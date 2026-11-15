-- The NPC editor. An NPC file saved from the editor overrides the archive's file of that name
-- (packages/data `npcfiles`). `text` is the file's lines joined by CR, as 1.6 wrote it; "" is a
-- 0-byte file (EMPTY NPC data). `npc` is the editor list's spelling of the name.
CREATE TABLE npc_files (
  npc TEXT PRIMARY KEY COLLATE NOCASE,
  text TEXT NOT NULL,
  saved_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every editor save keeps the file as it was before, with the shop's live stock and gold written
-- in, as LOAD showed it.
CREATE TABLE npc_file_versions (
  id TEXT PRIMARY KEY,
  npc TEXT NOT NULL COLLATE NOCASE,
  saved_by TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX npc_file_versions_by_npc ON npc_file_versions (npc, created_at);
