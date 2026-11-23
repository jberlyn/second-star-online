import { expect, test } from "bun:test";

import { footWalkGrid } from "@secondstaronline/shared";

import { openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords, saveMap } from "../src/persistence/maps.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";
import { queueCast } from "../src/systems/spells/fx.ts";
import { playerLoc } from "../src/systems/spells/geometry.ts";
import { crossMapEdge, tick } from "../src/systems/world/tick.ts";
import { addPlayer, createWorld, toWorldMap } from "../src/systems/world/world.ts";
import { NO_CASINO, player, rngByN, testMap } from "./helpers/sim.ts";

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
  // A wall clock moving one second a tick, and a sentence of 100 seconds.
  const clock = { ms: Date.parse("2026-11-17T09:00:00.000Z") };
  bob.jailUntil = clock.ms + 100_000;
  const deps = {
    now: () => clock.ms,
    loadMap: (name: string) => (name === jail.name ? jail : home),
    loadMapById: () => home,
    fallbackPoint: { map: home.name, x: 6, y: 4 },
    casino: NO_CASINO,
    saveIntervalTicks: 600,
    rng: rngByN(),
    portalTargets: [{ map: home.name, x: 5, y: 5 }],
  };
  db.close();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.ms += 1000;
      tick(world, deps);
    }
  };
  return { world, bob, jail, home, deps, step, sentence: bob.jailUntil };
}

test("jail blocks Portal and exits while keeping the sentence and normal respawn point", () => {
  const { world, bob, jail, home, step, sentence } = scene();
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
  step(20);
  expect(bob.map.name).toBe(jail.name);
  expect(bob.jailUntil).toBe(sentence);
  jail.exit1 = { mx: 1000, my: 992, x: 5, y: 5 };
  jail.ground.push({ id: "exit", item: "Exit", x: 4, y: 4, kind: "admin", expiresAt: null });
  step();
  expect(bob.map.name).toBe(jail.name);
  expect(bob.jailUntil).toBe(sentence);
});

test("death revives a prisoner in jail without restarting the sentence; expiry still releases", () => {
  const { bob, jail, home, step, sentence } = scene();
  bob.deadLock = 1;
  step();
  expect([bob.map.name, bob.x, bob.y, bob.jailUntil]).toEqual([jail.name, 4, 4, sentence]);
  expect(bob.char.respawn?.mapId).toBe(home.id);
  // The sentence is checked once a second (every 20 ticks): it ends by the 120th tick.
  step(119);
  // Released to his own respawn point (5, 5), not the start point.
  expect([bob.map.name, bob.x, bob.y, bob.jailUntil]).toEqual([home.name, 5, 5, null]);
});

test("every jail edge refuses a map crossing, even for an arriving airship rider", () => {
  const { world, bob, jail, deps, sentence } = scene();
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
    expect(bob.jailUntil).toBe(sentence);
  }
});

test("SSO: the jail is the jailPoint setting's map and tile, not x0y0", () => {
  // A jail moved to x7y7 (3, 9): x0y0 is an ordinary map, and the new map holds the prisoner.
  const cell = testMap("x7y7");
  const home = testMap("x1000y992");
  const oldJail = testMap("x0y0");
  const world = createWorld();
  world.jail = { map: cell.name, x: 3, y: 9 };
  const bob = player("Bob", cell, 6, 6);
  bob.char.respawn = { mapId: home.id, x: 5, y: 5 };
  addPlayer(world, bob);
  bob.loading = 0;
  const clock = { ms: Date.parse("2026-11-23T09:00:00.000Z") };
  bob.jailUntil = clock.ms + 100_000;
  const deps = {
    now: () => clock.ms,
    loadMap: (name: string) => [cell, home, oldJail].find((m) => m.name === name) ?? null,
    loadMapById: () => home,
    fallbackPoint: { map: home.name, x: 6, y: 4 },
    casino: NO_CASINO,
    saveIntervalTicks: 600,
    rng: rngByN(),
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.ms += 1000;
      tick(world, deps);
    }
  };
  // Death in jail revives on the jail's own tile.
  bob.deadLock = 1;
  step();
  expect([bob.map.name, bob.x, bob.y]).toEqual(["x7y7", 3, 9]);
  // Its edges hold the prisoner.
  expect(
    crossMapEdge(world, deps, {
      player: bob,
      outcome: { kind: "edge", facing: "S", toX: 5, toY: 5, dmx: 0, dmy: 1 },
    }),
  ).toEqual([]);
  expect(bob.map.name).toBe("x7y7");
  // The sentence ends and the prisoner goes home.
  step(120);
  expect([bob.map.name, bob.x, bob.y]).toEqual([home.name, 5, 5]);
  expect(bob.jailUntil).toBeNull();
  // x0y0 no longer holds anyone: someone there crosses its edge freely.
  const ann = player("Ann", oldJail, 5, 12);
  addPlayer(world, ann);
  ann.loading = 0;
  expect(
    crossMapEdge(
      world,
      { ...deps, loadMap: () => home },
      {
        player: ann,
        outcome: { kind: "edge", facing: "S", toX: 5, toY: 1, dmx: 0, dmy: 1 },
      },
    ),
  ).not.toEqual([]);
});
