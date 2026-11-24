import { expect, test } from "bun:test";

import { churchMapData } from "@secondstaronline/data";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { footWalkGrid } from "@secondstaronline/shared";

import { seedNewWorld } from "../src/content/world-seed.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords, saveMap } from "../src/persistence/maps.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";
import { loadSettingOverrides } from "../src/persistence/settings.ts";
import { resolveSettings } from "../src/settings.ts";

test("a new Classic world has no church: the bell still names x999y999, which 1.6 never shipped", () => {
  const db = openDatabase();
  migrate(db);
  seedNewWorld(db, "classic", RELEASE_PACK_DIRS, "2026-11-24T00:00:00.000Z");
  expect(findMapByCoords(db, 999, 999)).toBeNull();
  expect(resolveSettings(loadSettingOverrides(db)).bellMap).toBe("x999y999");
  db.close();
});

test("an upgraded server keeps its Church of the Bells: the migration's map is still validated content", () => {
  const db = openDatabase();
  migrate(db);
  const church = findMapByCoords(db, 999, 999)!;
  expect(church.title).toBe("Church of the Bells");
  expect(church.layers).toEqual(churchMapData.layers);
  expect(church.exit1).toBeNull();
  expect(church.exit2).toBeNull();
  const grid = footWalkGrid(church.layers[0], church.layers[1]);
  expect(grid[10]?.[8]).toBe(true); // carpet entrance (9,11)
  db.close();
});

test("the church migration preserves an operator-authored map at x999y999", () => {
  const db = openDatabase();
  runMigrations(
    db,
    loadMigrations().filter((m) => !m.name.includes("church_map")),
  );
  const home = findMapByCoords(db, 1000, 992)!;
  saveMap(db, { ...home, mx: 999, my: 999, title: "Custom chapel" }, "now");
  const before = findMapByCoords(db, 999, 999);
  migrate(db);
  expect(findMapByCoords(db, 999, 999)).toEqual(before);
  db.close();
});
