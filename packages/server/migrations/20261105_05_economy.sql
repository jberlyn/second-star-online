-- NPC shops, the bank and the personal vault.

-- The live copy of each NPC file's `GLD|`, `SEL|` and `BUY|` lines. One ledger per NPC name, shared
-- by every map that places it, as 1.6 kept one file per NPC. A ledger is created from the shipped
-- template the first time it is used; until then the template is the
-- state. `gold` is NULL when the file has no `GLD|` line (goods free, sales unpaid).
CREATE TABLE npc_shops (
  npc TEXT PRIMARY KEY,
  gold INTEGER,
  updated_at TEXT NOT NULL
);

-- `line` is the file line (the buy loop's inner-loop bug depends on it).
-- `stock` is NULL on BUY lines.
CREATE TABLE npc_shop_lines (
  npc TEXT NOT NULL REFERENCES npc_shops(npc) ON DELETE CASCADE,
  line INTEGER NOT NULL CHECK (line >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('SEL', 'BUY')),
  item TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER,
  PRIMARY KEY (npc, line)
);

-- 1.6 kept each bank balance in its own text file; SSO keys it by character. The row appears with
-- the first `/balance`, `/deposit` or `/withdraw` (1.6 wrote "0" on the first balance).
CREATE TABLE bank_accounts (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL CHECK (balance >= 0),
  updated_at TEXT NOT NULL
);

-- The personal vault: 1.6 kept it in its own text file, one item name per line, in order. Capacity
-- 15.
CREATE TABLE vault_items (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  item TEXT NOT NULL,
  PRIMARY KEY (character_id, position)
);
