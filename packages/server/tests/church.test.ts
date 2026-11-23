import { expect, test } from "bun:test";

import { churchMapData } from "@secondstaronline/data";
import { footWalkGrid } from "@secondstaronline/shared";

import { openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords, saveMap } from "../src/persistence/maps.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";

test("the seeded church is the validated Church of the Bells at x999y999 with no exits", () => {
  const db = openDatabase();
  migrate(db);
  const church = findMapByCoords(db, 999, 999)!;
  expect(church.name).toBe("x999y999");
  expect(church.title).toBe("Church of the Bells");
  expect(church.layers).toEqual(churchMapData.layers);
  expect(church.exit1).toBeNull();
  expect(church.exit2).toBeNull();
  expect(church.flags).toEqual({ canFight: "O", canPvp: "O", isIndoors: "O", fctSpwn: "" });
  expect(church.layers[0].join(" ")).not.toContain("J2");

  const grid = footWalkGrid(church.layers[0], church.layers[1]);
  expect(grid[10]?.[8]).toBe(true); // carpet entrance (9,11)
  expect(grid[2]?.[8]).toBe(true); // altar approach (9,3)
  for (let y = 3; y <= 11; y++) {
    expect(grid[y - 1]?.[8]).toBe(true); // the carpet aisle is clear
  }
  expect(grid[3]?.[2]).toBe(false); // a left pew (3,4)
  expect(grid[3]?.[11]).toBe(false); // a right pew (12,4)

  // No walkable tile touches any screen edge, so the enclosed church cannot accidentally cross maps.
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 17; x++) {
      if (x === 0 || x === 16 || y === 0 || y === 11) {
        expect(grid[y]?.[x]).toBe(false);
      }
    }
  }

  // Every walkable tile is reachable from the arrival tile.
  const seen = new Set<string>();
  const queue: [number, number][] = [[9, 11]];
  while (queue.length) {
    const [x, y] = queue.pop() as [number, number];
    const k = `${x},${y}`;
    if (seen.has(k) || !grid[y - 1]?.[x - 1]) {
      continue;
    }
    seen.add(k);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  expect(seen.size).toBe(grid.flat().filter(Boolean).length);
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
