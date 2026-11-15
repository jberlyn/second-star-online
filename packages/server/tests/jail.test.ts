import { expect, test } from "bun:test";

import { footWalkGrid } from "@secondstaronline/shared";

import { openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords, saveMap } from "../src/persistence/maps.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";
import { queueCast } from "../src/systems/spells/fx.ts";
import { playerLoc } from "../src/systems/spells/geometry.ts";
import { crossMapEdge, tick } from "../src/systems/world/tick.ts";
import { addPlayer, createWorld, toWorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, testMap } from "./helpers/sim.ts";

test("the seeded jail encloses every walkable area and has no exits or landing pads", () => {
  const db = openDatabase();
  migrate(db);
  const jail = findMapByCoords(db, 0, 0)!;
  expect(jail.title).toBe("Jail");
  expect(jail.exit1).toBeNull();
  expect(jail.exit2).toBeNull();
  expect(jail.layers[0].join(" ")).not.toContain("J2");
  expect(jail.flags).toEqual({ canFight: "O", canPvp: "O", isIndoors: "O", fctSpwn: "X" });
  const grid = footWalkGrid(jail.layers[0], jail.layers[1]);
  expect(grid[3]?.[3]).toBe(true); // /jail arrival (4,4)
  // No walkable tile touches any screen edge, even outside the arrival cell.
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 17; x++) {
      if (x === 0 || x === 16 || y === 0 || y === 11) {
        expect(grid[y]?.[x]).toBe(false);
      }
    }
  }
  db.close();
});

test("the jail migration preserves an operator-authored map at x0y0", () => {
  const db = openDatabase();
  runMigrations(
    db,
    loadMigrations().filter((m) => !m.name.includes("jail_map")),
  );
  const home = findMapByCoords(db, 1000, 992)!;
  saveMap(db, { ...home, mx: 0, my: 0, title: "Custom prison" }, "now");
  const before = findMapByCoords(db, 0, 0);
  migrate(db);
  expect(findMapByCoords(db, 0, 0)).toEqual(before);
  db.close();
});

function scene() {
  const db = openDatabase();
  migrate(db);
  const jail = toWorldMap(findMapByCoords(db, 0, 0)!);
  const home = testMap("x1000y992");
  const world = createWorld();
  const bob = player("Bob", jail, 4, 4);
  bob.char.respawn = { mapId: home.id, x: 5, y: 5 };
  addPlayer(world, bob);
  bob.loading = 0;
  bob.jailIn = 100;
  const deps = {
    loadMap: (name: string) => (name === jail.name ? jail : home),
    loadMapById: () => home,
    startPoint: { map: home.name, x: 6, y: 4 },
    saveIntervalTicks: 600,
    rng: rngByN(),
    portalTargets: [{ map: home.name, x: 5, y: 5 }],
  };
  db.close();
  return { world, bob, jail, home, deps };
}

test("jail blocks Portal and exits while keeping the sentence and normal respawn point", () => {
  const { world, bob, jail, home, deps } = scene();
  expect(bob.char.respawn?.mapId).toBe(home.id);
  const room = world.rooms.get(jail.name)!;
  const loc = playerLoc(bob);
  queueCast(room, {
    owner: "Ann",
    ownerId: null,
    name: "Portal",
    casterH: loc.h,
    casterV: loc.v,
    h: loc.h,
    v: loc.v,
    power: 1,
  });
  for (let i = 0; i < 20; i++) {
    tick(world, deps);
  }
  expect(bob.map.name).toBe(jail.name);
  expect(bob.jailIn).toBe(80);
  jail.exit1 = { mx: 1000, my: 992, x: 5, y: 5 };
  jail.ground.push({ id: "exit", item: "Exit", x: 4, y: 4, kind: "admin", expiresAt: null });
  tick(world, deps);
  expect(bob.map.name).toBe(jail.name);
  expect(bob.jailIn).toBe(79);
});

test("death revives a prisoner in jail without restarting the sentence; expiry still releases", () => {
  const { world, bob, jail, home, deps } = scene();
  bob.deadLock = 1;
  tick(world, deps);
  expect([bob.map.name, bob.x, bob.y, bob.jailIn]).toEqual([jail.name, 4, 4, 99]);
  expect(bob.char.respawn?.mapId).toBe(home.id);
  for (let i = 0; i < 99; i++) {
    tick(world, deps);
  }
  expect([bob.map.name, bob.x, bob.y, bob.jailIn]).toEqual([home.name, 6, 4, 0]);
});

test("every jail edge refuses a map crossing, even for an arriving airship rider", () => {
  const { world, bob, jail, deps } = scene();
  bob.vehicle = "Airship";
  for (const [dmx, dmy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const out = crossMapEdge(world, deps, {
      player: bob,
      outcome: { kind: "edge", facing: "S", toX: 5, toY: 5, dmx, dmy },
    });
    expect(out).toEqual([]);
    expect(bob.map.name).toBe(jail.name);
    expect(bob.jailIn).toBe(100);
  }
});
