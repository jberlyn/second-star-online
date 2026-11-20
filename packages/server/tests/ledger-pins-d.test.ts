/**
 * Pins for design changes in docs/differences-from-fso.md: lifted sprite-channel limits, the World
 * Editor's save, art-less monsters, operator world settings and the production security headers.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { monstersData } from "@secondstaronline/data";
import {
  EDITOR_ITEM_SLOTS,
  EDITOR_MONSTERS,
  EDITOR_NPCS,
  emptyBag,
  parseNpcFile,
} from "@secondstaronline/shared";

import { systemClock } from "../src/clock.ts";
import { createGame } from "../src/game.ts";
import { securityHeaders, startGateway } from "../src/gateway/server.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { scriptedRng } from "../src/rng.ts";
import { defaultSettings } from "../src/settings.ts";
import { applySave, editorView, saveError } from "../src/systems/admin/worldedit.ts";
import { pollAttack, setAttackHeld } from "../src/systems/combat/melee.ts";
import { ledgerFromTemplate, npcBuy, sellList } from "../src/systems/economy/shop.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import { spawnLadder, spawnPass } from "../src/systems/monsters/spawn.ts";
import { placeQueued, queueCast } from "../src/systems/spells/fx.ts";
import { serverTimer, TIMEOUT_TICKS } from "../src/systems/spells/hazards.ts";
import { MAX_EMULATED_PLAYERS } from "../src/systems/world/tick.ts";
import { createWorld, type Room, type WorldMap } from "../src/systems/world/world.ts";
import { ARCHIVE_NPCS, player, rngByN, setup, testMap } from "./helpers/sim.ts";

const liveIn = (map: WorldMap, slot: number, name: string, x: number, y: number, hp: number) => {
  const s = map.slots[slot - 1] as MonsterSlot;
  s.species = name;
  s.pause = 1_000_000; // keep it still
  s.live = {
    name,
    hp,
    x,
    y,
    facing: "S",
    anim: 0,
    fromX: x,
    fromY: y,
    queue: [],
    hitCountb: 0,
  };
  return s;
};

describe("World editor saves keep loot and player drops", () => {
  test("design change: the editor shows and replaces only placed items, at most 20; loot and drops stay", () => {
    const a = testMap("x1000y992");
    a.ground.push(
      { id: "loot", item: "2 Gold", x: 1, y: 1, kind: "loot", expiresAt: 1 },
      { id: "drop", item: "Knife", x: 2, y: 1, kind: "drop", expiresAt: null },
      { id: "placed", item: "Apple", x: 3, y: 1, kind: "admin", expiresAt: null },
    );
    const { world } = setup([a]);
    const m = editorView(a, 1000, 992);
    // The loot and the player's drop are not editor items.
    expect(m.items).toEqual([{ name: "Apple", x: 3, y: 1 }]);
    m.items = Array.from({ length: EDITOR_ITEM_SLOTS + 1 }, (_, i) => ({
      name: "Apple",
      x: (i % 17) + 1,
      y: Math.floor(i / 17) + 4,
    }));
    expect(EDITOR_ITEM_SLOTS).toBe(20);
    expect(saveError(m)).not.toBeNull();
    m.items = [{ name: "Long Sword", x: 9, y: 9 }];
    let n = 0;
    const r = applySave(world, a, m, () => `new${n++}`);
    expect(r.removed).toEqual(["placed"]);
    expect(a.ground.map((g) => [g.id, g.kind])).toEqual([
      ["loot", "loot"],
      ["drop", "drop"],
      ["new0", "admin"],
    ]);
  });
});

describe("No per-swing target slot limit", () => {
  test("design change: a swing considers every live monster in the map instance", () => {
    const map = testMap("x1000y992");
    const rng = rngByN();
    const { world, join } = setup([map], undefined, rng);
    const a = player("Ann", map, 5, 5);
    a.facing = "E";
    a.flicker = 0;
    join(a);
    // Every slot holds a monster; two of them, slots 1 and 4, stand on the faced tile.
    liveIn(map, 1, "Slime", 6, 5, 1000);
    liveIn(map, 2, "Slime", 10, 10, 1000);
    liveIn(map, 3, "Slime", 12, 10, 1000);
    liveIn(map, 4, "Slime", 6, 5, 1000);
    a.timers.canAttack = true;
    setAttackHeld(a, true);
    const room = world.rooms.get(map.name) as Room;
    const ev = pollAttack(room, a, { rng, now: 0, world });
    expect(ev.hits.map((h) => h.slot.slot)).toEqual([1, 4]);
  });
});

describe("No per-map ground-item slot limit", () => {
  test("design change: loot drops on a map already holding more than 20 ground items", () => {
    const map = testMap("x1000y992");
    for (let i = 0; i < 30; i++) {
      map.ground.push({
        id: `g${i}`,
        item: "Apple",
        x: (i % 17) + 1,
        y: Math.floor(i / 17) + 8,
        kind: "drop",
        expiresAt: null,
      });
    }
    // random(4) = 1 picks the Slime's "2 Gold:1" line; random(1) = 1 drops it.
    const rng = rngByN({ 4: Array(20).fill(1) });
    const { world, join } = setup([map], undefined, rng);
    const a = player("Ann", map, 5, 5);
    a.facing = "E";
    a.flicker = 0;
    a.char.stats.str = 20;
    join(a);
    liveIn(map, 1, "Slime", 6, 5, 1);
    a.timers.canAttack = true;
    setAttackHeld(a, true);
    const ev = pollAttack(world.rooms.get(map.name) as Room, a, { rng, now: 0, world });
    expect(ev.hits).toMatchObject([{ kill: true }]);
    expect(map.ground).toHaveLength(31);
    expect(map.ground.at(-1)).toMatchObject({ item: "2 Gold", x: 6, y: 5, kind: "loot" });
  });
});

describe("Monster population: one live monster per roster slot, sprite cap removed", () => {
  test("design change: a slot with a live monster never spawns a second", () => {
    const map = testMap("x1");
    const s = liveIn(map, 1, "Slime", 2, 2, 14);
    s.pause = 0;
    const before = s.live;
    // Every roll that would spawn passes: the gate, the tile and random(5).
    const rng = rngByN({ 80: [1], 17: [7], 12: [3], 5: [1], 4: [2] });
    expect(spawnPass(map, { rng, players: 1, minute: 0 })).toEqual([]);
    expect(map.slots[0]?.live).toBe(before);
    // Only the gate was drawn: the occupied slot rolls no tile.
    expect(rng.calls).toEqual([80]);
  });

  test("design change: spawn rolls run per player, two passes a tick, capped at 15 players", () => {
    const gates = (players: number) => {
      const map = testMap("x1000y992");
      liveIn(map, 1, "Slime", 1, 1, 14);
      const rng = rngByN();
      const { join, run } = setup([map], undefined, rng);
      for (let i = 0; i < players; i++) {
        const p = player(`p${i}`, map, (i % 15) + 2, Math.floor(i / 15) * 2 + 4);
        join(p);
        p.monDropIn = 0;
      }
      run(1);
      return rng.calls.filter((n) => n === spawnLadder(players)).length;
    };
    expect(gates(3)).toBe(2 * 3);
    expect(gates(20)).toBe(2 * MAX_EMULATED_PLAYERS);
  });
});

describe("No 11-spell FX cap", () => {
  test("design change: fifteen effects on one map take fifteen slots, none replaced", () => {
    const map = testMap("x1000y992");
    const room: Room = { map, npcs: ARCHIVE_NPCS, players: [], fx: [], fxQueue: [], doorLock: 0 };
    for (let i = 0; i < 15; i++) {
      queueCast(room, {
        owner: `c${i}`,
        ownerId: null,
        name: "Music",
        casterH: 100 + i,
        casterV: 200,
        h: 100 + i,
        v: 200,
        power: 1,
        train: false,
      });
    }
    const res = placeQueued(room, rngByN());
    expect(res.events).toHaveLength(15);
    expect(room.fx.map((f) => f.slot)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(room.fx.map((f) => f.owner)).toEqual(Array.from({ length: 15 }, (_, i) => `c${i}`));
  });
});

describe("Shop window lists every SEL line", () => {
  test("design change: a SEL line past file line 30 is listed and bought by its line", () => {
    const text = [
      "BIO|Name: Tess",
      ...Array.from({ length: 33 }, (_, i) => `BIO|filler ${i}`),
      "GLD|100",
      "SEL|Apple:5:10",
      "SEL|Knife:7:3",
    ].join("\r");
    const shop = ledgerFromTemplate(parseNpcFile("Tess", text));
    expect(sellList(shop)).toEqual([
      { line: 36, item: "Apple", price: 5 },
      { line: 37, item: "Knife", price: 7 },
    ]);
    const r = npcBuy(shop, 37, 1, { gold: 100, bag: emptyBag() }, rngByN());
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "Knife", qty: 1 });
  });
});

describe("Monsters without art are not placeable", () => {
  test("design change: the editor lists offer no art-less body; their data stays", () => {
    const artless = monstersData.monsters.filter((m) => !m.bodyInMainChars).map((m) => m.name);
    expect(artless).toEqual(
      expect.arrayContaining(["Stone Skull", "Dragon", "Ogre", "Overlord", "Naked Stripper"]),
    );
    for (const name of [...EDITOR_MONSTERS, ...EDITOR_NPCS]) {
      expect(artless).not.toContain(name);
    }
    // Their stats remain in the monster data.
    expect(species("Stone Skull")?.hp).toBeGreaterThan(0);
    // A save naming one is refused.
    const map = testMap("x1000y992");
    const m = editorView(map, 1000, 992);
    m.mobs = [{ name: "Stone Skull", x: 4, y: 4 }, null, null, null];
    expect(saveError(m)).not.toBeNull();
  });
});

describe("Hard-coded world references become operator settings", () => {
  test("design change: treasure maps, portal targets and the hazard map are empty by default", () => {
    const s = defaultSettings();
    expect(s.treasureMaps).toEqual([]);
    expect(s.portalTargets).toEqual([]);
    expect(s.hazardMap).toBeNull();
    // With no hazard map the Server Spirit's rolls that would cast hit no room.
    const world = createWorld();
    const map = testMap("x5y5");
    const room: Room = { map, npcs: ARCHIVE_NPCS, players: [], fx: [], fxQueue: [], doorLock: 0 };
    world.rooms.set("x5y5", room);
    world.tickNo = TIMEOUT_TICKS;
    serverTimer(world, s.hazardMap, rngByN({ 50: [1], 10: [1] }));
    expect(room.fxQueue).toEqual([]);
  });
});

describe("Security headers and production mode", () => {
  const root = mkdtempSync(join(tmpdir(), "sso-pins-d-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const game = () => {
    const db = openDatabase(":memory:");
    migrate(db);
    return createGame({
      db,
      send: () => {},
      isoNow: () => "2026-11-14T00:00:00.000Z",
      rng: scriptedRng([1]),
      kick: () => {},
      dropOtherSessions: () => {},
    });
  };

  test("design change: the CSP allows only own scripts, no plugins or <base>; frame-ancestors only when set", () => {
    expect(securityHeaders()).toEqual({
      "x-content-type-options": "nosniff",
      "content-security-policy": "script-src 'self'; object-src 'none'; base-uri 'none'",
    });
    expect(securityHeaders("https://example.org")["content-security-policy"]).toContain(
      "frame-ancestors https://example.org",
    );
  });

  test("design change: production puts the headers on every response, a 404 too; development sends no CSP", async () => {
    const clientDir = join(root, "client");
    const assetsDir = join(root, "assets");
    mkdirSync(clientDir, { recursive: true });
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>T</title>");
    const prod = startGateway({
      port: 0,
      development: false,
      game: game(),
      clock: systemClock,
      assetsDir,
      clientDir,
      frameAncestors: "'self'",
    });
    try {
      const res = await fetch(new URL("/missing", prod.url));
      expect(res.status).toBe(404);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    } finally {
      await prod.stop();
    }
    const dev = startGateway({
      port: 0,
      development: true,
      game: game(),
      clock: systemClock,
      assetsDir,
    });
    try {
      const res = await fetch(dev.url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toBeNull();
    } finally {
      await dev.stop();
    }
  });
});
