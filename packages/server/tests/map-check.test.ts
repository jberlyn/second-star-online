import { expect, test } from "bun:test";

import { mapCheck } from "../src/cli/map-check.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords, saveMapExits } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";

test("the seeded world has no travel that leads nowhere", () => {
  const db = openDatabase();
  migrate(db);
  expect(mapCheck(db)).toEqual([]);
  db.close();
});

test("lists dangling exits, Exit tiles with no exit set and setting points on missing maps", () => {
  const db = openDatabase();
  migrate(db);
  const seed = findMapByCoords(db, 1000, 992);
  if (!seed) {
    throw new Error("no seed map");
  }
  saveMapExits(db, seed.id, { mx: 1, my: 1, x: 5, y: 6 }, null, "now");
  db.run(
    "INSERT INTO ground_items (id, map_id, x, y, item, kind, created_at) VALUES ('g', ?, 3, 4, 'Exit2', 'admin', 'now')",
    [seed.id],
  );
  saveSettingOverride(db, "portalTargets", [{ map: "x7y7", x: 2, y: 3 }], "now");
  expect(mapCheck(db)).toEqual([
    "x1000y992: Exit leads to x1y1 (5, 6), which does not exist",
    "x1000y992: an Exit2 tile at (3, 4) has no Exit2 set",
    "setting portalTargets 1: x7y7 (2, 3) does not exist",
  ]);
  db.close();
});
