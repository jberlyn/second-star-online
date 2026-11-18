/**
 * Persistence (real SQL on in-memory SQLite) and seeded sim replays.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  blankMap,
  footWalkGrid,
  inGameSchema,
  mapName,
  type ServerMsg,
  startingCharacter,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import {
  findCharacterById,
  insertCharacter,
  loadBag,
  loadSkills,
  savePosition,
  saveProgress,
} from "../src/persistence/characters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadSettingOverrides, saveSettingOverride } from "../src/persistence/settings.ts";
import { defaultSettings, resolveSettings, SETTING_GROUPS, settingRows } from "../src/settings.ts";
import { pressStep, setHeld } from "../src/systems/movement/movement.ts";
import { tick, warp } from "../src/systems/world/tick.ts";
import { addPlayer, createWorld } from "../src/systems/world/world.ts";
import { NEVER_PUSH, NO_CASINO, player, rngByN, setup, testMap } from "./helpers/sim.ts";

const NOW = "2026-11-04T00:00:00.000Z";
let db: Db;

beforeEach(() => {
  db = openDatabase();
  migrate(db);
});

describe("seed map migration", () => {
  test("Willowbrook Wilds has a 17×12 lake, forest and rocks with empty upper layers", () => {
    const m = findMapByCoords(db, 1000, 992);
    if (!m) {
      throw new Error("seed map missing");
    }
    expect(m.name).toBe("x1000y992");
    expect(m.title).toBe("Willowbrook Wilds");
    for (const layer of m.layers) {
      expect(layer).toHaveLength(12);
      for (const row of layer) {
        expect(row.split(" ")).toHaveLength(17);
      }
    }
    expect(new Set(m.layers[0].join(" ").split(" "))).toEqual(new Set(["G1", "N1"]));
    expect(new Set(m.layers[1].join(" ").split(" "))).toEqual(
      new Set(["G3", "S3", "T3", "N3", "B8", "T8", "Q6", "T7", "P7", "B7"]),
    );
    expect(new Set(m.layers[2].join(" ").split(" "))).toEqual(new Set(["G3"]));
    expect(new Set(m.layers[3].join(" ").split(" "))).toEqual(new Set(["5A"]));
  });

  test("the start (6,4) and respawn (5,5) tiles are walkable, trees are not, every edge is reachable", () => {
    const m = findMapByCoords(db, 1000, 992);
    if (!m) {
      throw new Error("seed map missing");
    }
    const walk = footWalkGrid(m.layers[0], m.layers[1]);
    const at = (x: number, y: number) => walk[y - 1]?.[x - 1];
    expect(at(6, 4)).toBe(true);
    expect(at(5, 5)).toBe(true);
    expect(at(2, 2)).toBe(false); // lake
    expect(at(7, 3)).toBe(false); // harvestable tree
    expect(m.layers[0][2]?.split(" ")[6]).toBe("G1"); // tree stands on land
    expect(at(12, 4)).toBe(false); // mineable rock
    expect(m.layers[0][3]?.split(" ")[11]).toBe("G1");
    // Flood fill from the start tile reaches all four edges.
    const seen = new Set<string>();
    const queue: [number, number][] = [[6, 4]];
    while (queue.length) {
      const [x, y] = queue.pop() as [number, number];
      const k = `${x},${y}`;
      if (seen.has(k) || !at(x, y)) {
        continue;
      }
      seen.add(k);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    const reached = [...seen].map((k) => k.split(",").map(Number) as [number, number]);
    // Every open tile belongs to the same clearing; resources can be approached on foot.
    expect(seen.size).toBe(walk.flat().filter(Boolean).length);
    for (const [x, y] of [
      [6, 4],
      [5, 5],
      [4, 10],
      [12, 5],
    ]) {
      expect(seen.has(`${x},${y}`)).toBe(true);
    }
    expect(reached.some(([x]) => x === 1)).toBe(true);
    expect(reached.some(([x]) => x === 17)).toBe(true);
    expect(reached.some(([, y]) => y === 1)).toBe(true);
    expect(reached.some(([, y]) => y === 12)).toBe(true);
  });
});

describe("settings", () => {
  test("defaults, and overrides that parse win", () => {
    expect(defaultSettings().startPoint).toEqual({ map: "x1000y992", x: 6, y: 4 });
    expect(defaultSettings().respawnPoint).toEqual({ map: "x1000y992", x: 5, y: 5 });
    saveSettingOverride(db, "startPoint", { map: "x1y2", x: 3, y: 4 }, NOW);
    saveSettingOverride(db, "saveIntervalTicks", "not a number", NOW);
    const s = resolveSettings(loadSettingOverrides(db));
    expect(s.startPoint).toEqual({ map: "x1y2", x: 3, y: 4 });
    expect(s.saveIntervalTicks).toBe(600);
  });

  test("walk speed is not a setting: no row, and a stored stepFrames is ignored", () => {
    expect("stepFrames" in defaultSettings()).toBe(false);
    expect(settingRows(defaultSettings()).some((r) => r.key === "stepFrames")).toBe(false);
    saveSettingOverride(db, "stepFrames", 8, NOW);
    expect("stepFrames" in resolveSettings(loadSettingOverrides(db))).toBe(false);
  });

  test("the Settings window's rows come section by section, every one explained", () => {
    const rows = settingRows(defaultSettings());
    const groups = rows.map((r) => r.group).filter((g, i, all) => all.indexOf(g) === i);
    expect(groups).toEqual([...SETTING_GROUPS]);
    expect(rows.every((r) => r.tooltip !== "")).toBe(true);
    expect(rows.find((r) => r.key === "jailMinutes")).toMatchObject({
      group: "Moderation and security",
      unit: "minutes",
    });
  });
});

describe("characters", () => {
  test("insert writes the record, 38 skills and the starting bag; position saves", () => {
    db.run(
      "INSERT INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES ('a1', 'alice', 'h', 'player', ?, ?)",
      [NOW, NOW],
    );
    const map = findMapByCoords(db, 1000, 992);
    if (!map) {
      throw new Error("seed map missing");
    }
    const start = startingCharacter({
      name: "alice",
      sex: 2,
      head: 7,
      classCode: 3,
      str: 1,
      sta: 1,
      int: 1,
      wis: 1,
      dex: 1,
    });
    const id = insertCharacter(db, {
      accountId: "a1",
      start,
      position: { mapId: map.id, x: 6, y: 4, facing: "N" },
      now: NOW,
    });
    expect(id.charAt(14)).toBe("7"); // UUIDv7
    expect(findCharacterById(db, id)).toMatchObject({ name: "alice", head: 7, classCode: 3 });
    expect(loadSkills(db, id)).toEqual(start.skills);
    expect(loadBag(db, id)).toEqual([
      { slot: 1, item: "Apple", qty: 2 },
      { slot: 2, item: "Knife", qty: 1 },
    ]);
    savePosition(db, id, { mapId: map.id, x: 9, y: 9, facing: "W" }, NOW);
    expect(findCharacterById(db, id)?.position).toEqual({ mapId: map.id, x: 9, y: 9, facing: "W" });
  });
});

describe("saving skills (open skill count)", () => {
  function newCharacter(): { id: string; progress: Parameters<typeof saveProgress>[2] } {
    db.run(
      "INSERT INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES ('a2', 'bob', 'h', 'player', ?, ?)",
      [NOW, NOW],
    );
    const map = findMapByCoords(db, 1000, 992);
    if (!map) {
      throw new Error("seed map missing");
    }
    const start = startingCharacter({
      name: "bob",
      sex: 1,
      head: 1,
      classCode: 1,
      str: 1,
      sta: 1,
      int: 1,
      wis: 1,
      dex: 1,
    });
    const id = insertCharacter(db, {
      accountId: "a2",
      start,
      position: { mapId: map.id, x: 6, y: 4, facing: "N" },
      now: NOW,
    });
    const rec = findCharacterById(db, id);
    if (!rec) {
      throw new Error("character missing");
    }
    const { aim: _aim, ...stats } = rec.stats;
    return {
      id,
      progress: {
        position: rec.position,
        vitals: rec.vitals,
        hunger: rec.hunger,
        skills: start.skills,
        respawn: rec.respawn,
        faction: rec.faction,
        wanted: rec.wanted,
        stats,
        medals: rec.medals,
        vehicle: rec.vehicle,
      },
    };
  }
  const changes = () => (db.query("SELECT total_changes() AS n").get() as { n: number }).n;

  test("a longer skill list inserts the missing rows", () => {
    const { id, progress } = newCharacter();
    const before = loadSkills(db, id);
    saveProgress(db, id, { ...progress, skills: [...before, 7] }, NOW);
    const after = loadSkills(db, id, before.length + 1);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toBe(7);
  });

  test("changed values are updated without adding rows; unchanged ones are not rewritten", () => {
    const { id, progress } = newCharacter();
    const before = loadSkills(db, id);
    const changed = before.map((v, i) => (i === 0 || i === 5 ? v + 3 : v));
    saveProgress(db, id, { ...progress, skills: changed }, NOW);
    expect(loadSkills(db, id)).toEqual(changed);
    // The character row is always written (1 change); the skill rows only when they differ.
    const n = changes();
    saveProgress(db, id, { ...progress, skills: changed }, NOW);
    expect(changes() - n).toBe(1);
    saveProgress(
      db,
      id,
      { ...progress, skills: changed.map((v, i) => (i === 2 ? v + 1 : v)) },
      NOW,
    );
    expect(changes() - n).toBe(1 + 2);
  });

  test("a character saved with 38 skill rows loads a 39th skill as 1, and the next save writes its row", () => {
    const { id, progress } = newCharacter();
    const before = loadSkills(db, id);
    expect(before).toHaveLength(38);
    const loaded39 = loadSkills(db, id, 39);
    expect(loaded39).toHaveLength(39);
    expect(loaded39[38]).toBe(1);
    saveProgress(db, id, { ...progress, skills: loaded39 }, NOW);
    const rowCount = (
      db.query("SELECT COUNT(*) AS n FROM character_skills WHERE character_id = ?").get(id) as {
        n: number;
      }
    ).n;
    expect(rowCount).toBe(39);
    expect(loadSkills(db, id, 39)[38]).toBe(1);
  });
});

// ---- sim replays ---------------------------------------------------------------------------

describe("movement sim", () => {
  test("a press shorter than one tick still steps once (the step impulse)", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    join(a);
    pressStep(a, "R", false);
    setHeld(a, null, false); // released before the tick
    run(1);
    // 16 calls, one used by actor pass 2 the same frame.
    expect([a.x, a.y, a.stepFrames]).toEqual([6, 5, 15]);
    run(40);
    expect([a.x, a.y]).toEqual([6, 5]);
  });

  test("a press made just before the step ends is kept and taken on time (4-tick buffer)", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    join(a);
    pressStep(a, "R", false);
    run(14); // the step started on the first tick; 3 frames are left
    pressStep(a, "D", false);
    run(3);
    expect([a.x, a.y]).toEqual([6, 6]);
  });

  test("a press made too early is dropped after 4 ticks", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    join(a);
    pressStep(a, "R", false);
    run(2); // 15 frames left: too early for the 4-tick buffer
    pressStep(a, "D", false);
    run(20);
    expect([a.x, a.y]).toEqual([6, 5]);
  });

  test("bug fixed: a player mid-step blocks the tile it steps onto; two never end on one tile", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    const b = player("b", seed, 7, 5);
    join(a);
    join(b);
    pressStep(b, "L", false);
    run(1); // b now logically at (6,5), mid-step
    pressStep(a, "R", false);
    const out = run(1);
    expect([a.x, a.y, a.facing, b.x, b.y]).toEqual([5, 5, "E", 6, 5]);
    expect(out.some((o) => o.to === "a" && o.msg.t === "you")).toBe(true);
  });

  test("the tile a moving player leaves is free at once", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    const b = player("b", seed, 6, 5);
    join(a);
    join(b);
    pressStep(b, "R", false);
    run(1); // b leaves (6,5) for (7,5)
    pressStep(a, "R", false);
    run(1);
    expect([a.x, b.x]).toEqual([6, 7]);
  });

  test("a standing player blocks: facing changes, the walker stays, and a 'you' is sent", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    const b = player("b", seed, 6, 5);
    join(a);
    join(b);
    run(1);
    pressStep(a, "R", false);
    const out = run(1);
    expect([a.x, a.facing]).toEqual([5, "E"]);
    expect(out).toContainEqual({
      to: "b",
      msg: { t: "delta", events: [{ e: "turn", id: "a", facing: "E" }] },
    });
    expect(out.some((o) => o.to === "a" && o.msg.t === "you")).toBe(true);
  });

  test("a held arrow steps every 8 ticks and peers are told 16 calls", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 2);
    const b = player("b", seed, 9, 9);
    join(a);
    join(b);
    setHeld(a, "D", false);
    const out = run(1);
    expect(out).toContainEqual({
      to: "b",
      msg: {
        t: "delta",
        events: [
          { e: "move", id: "a", fromX: 5, fromY: 2, toX: 5, toY: 3, facing: "S", frames: 16 },
        ],
      },
    });
    run(8 * 3);
    // The fourth step starts in frame 25's key poll; pass 2 uses one call.
    expect([a.y, a.stepFrames]).toEqual([6, 15]);
  });

  test("trees block on foot (whitelist)", () => {
    const seed = testMap("x1000y992", [[6, 5]]);
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    join(a);
    pressStep(a, "R", false);
    run(1);
    expect([a.x, a.facing, a.stepFrames]).toEqual([5, "E", 0]);
  });

  test("walking off an edge onto an existing neighbour keeps the wrapped tile", () => {
    const seed = testMap("x1000y992");
    const east = testMap(mapName(1001, 992), [[1, 6]]); // a tree beside the arrival tile
    const { world, join, run } = setup([seed, east]);
    const a = player("a", seed, 17, 5);
    join(a);
    pressStep(a, "R", false);
    const out = run(1);
    expect([a.map.name, a.x, a.y, a.facing]).toEqual(["x1001y992", 1, 5, "E"]);
    expect(out.some((o) => o.to === "a" && o.msg.t === "snapshot")).toBe(true);
    expect(a.loading).toBe(100);
    expect(world.rooms.has("x1000y992")).toBe(false); // empty room unloaded
  });

  test("bug fixed: an unwalkable wrapped tile refuses the crossing, as a wall would", () => {
    const seed = testMap("x1000y992");
    const east = testMap(mapName(1001, 992), [[1, 5]]); // a tree on the arrival tile
    const { join, run } = setup([seed, east]);
    const a = player("a", seed, 17, 5);
    a.facing = "N";
    join(a);
    pressStep(a, "R", false);
    const out = run(1);
    expect([a.map.name, a.x, a.y, a.facing]).toEqual(["x1000y992", 17, 5, "E"]);
    expect(out.some((o) => o.to === "a" && o.msg.t === "snapshot")).toBe(false);
  });

  test("bug fixed: an edge with no map beyond is refused, as a wall would", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 1, 9);
    join(a);
    pressStep(a, "L", false);
    const out = run(1);
    expect([a.map.name, a.x, a.y, a.facing]).toEqual(["x1000y992", 1, 9, "W"]);
    expect(out.some((o) => o.to === "a" && o.msg.t === "snapshot")).toBe(false);
  });

  test("loading: no movement until mapReady or 100 ticks", () => {
    const seed = testMap("x1000y992");
    const { world, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    addPlayer(world, a);
    setHeld(a, "R", false);
    run(99); // `loading` counts frames, once per tick, not per stepFrame
    expect(a.x).toBe(5);
    run(1);
    expect(a.x).toBe(6);
  });

  test("turn in place is broadcast; the mover gets 'you', not a delta", () => {
    const seed = testMap("x1000y992");
    const { join, run } = setup([seed]);
    const a = player("a", seed, 5, 5);
    const b = player("b", seed, 9, 9);
    join(a);
    join(b);
    run(1);
    pressStep(a, "D", true);
    const out = run(1);
    expect(a.facing).toBe("S");
    expect(out.filter((o) => o.to === "a").map((o) => o.msg.t)).toEqual(["you"]);
    expect(out).toContainEqual({
      to: "b",
      msg: { t: "delta", events: [{ e: "turn", id: "a", facing: "S" }] },
    });
  });
});

describe("game: creation through the real database", () => {
  let game: Game;
  const sent: { to: string; msg: ServerMsg }[] = [];
  beforeEach(() => {
    sent.length = 0;
    game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => NOW,
      rng: NEVER_PUSH,
    });
  });

  test("creates the account and character together; login finds them; fresh logins face south", async () => {
    const r = await game.create({
      t: "create",
      name: "Alice",
      password: "pw",
      sex: 2,
      head: 8,
      classCode: 2,
      str: 5,
      sta: 5,
      int: 20,
      wis: 20,
      dex: 5,
    });
    expect(r).toEqual({ ok: true });
    const login = await game.login("alice", "pw");
    if (!login.ok) {
      throw new Error(login.text);
    }
    expect(login.name).toBe("Alice");
    expect(game.enter(login.characterId, false)).toBe(true);
    const snap = sent.find((s) => s.msg.t === "snapshot");
    expect(snap?.msg).toMatchObject({ self: { x: 6, y: 4, facing: "S" }, you: { head: 8 } });
  });

  test("SSO: new characters start on the operator's start point setting, default x1000y992 (6, 4) on the seed map", async () => {
    expect(defaultSettings().startPoint).toEqual({ map: "x1000y992", x: 6, y: 4 });
    saveSettingOverride(db, "startPoint", { map: "x1000y992", x: 8, y: 9 }, NOW);
    const g = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => NOW,
      rng: NEVER_PUSH,
    });
    await g.create({
      t: "create",
      name: "Bea",
      password: "pw",
      sex: 1,
      head: 1,
      classCode: 1,
      str: 11,
      sta: 11,
      int: 11,
      wis: 11,
      dex: 11,
    });
    const login = await g.login("bea", "pw");
    if (!login.ok) {
      throw new Error(login.text);
    }
    expect(g.enter(login.characterId, false)).toBe(true);
    const snap = sent.find((m) => m.msg.t === "snapshot");
    expect(snap?.msg).toMatchObject({ self: { x: 8, y: 9 } });
  });

  test("creation re-checks the screen's rules on the server", async () => {
    const r = await game.create({
      t: "create",
      name: "cheater",
      password: "pw",
      sex: 1,
      head: 1,
      classCode: 1,
      str: 20,
      sta: 20,
      int: 20,
      wis: 1,
      dex: 1,
    });
    expect(r).toEqual({ ok: false, text: "You have spent more than 50 points." });
  });
});

describe("the respawn point", () => {
  test("SSO: the server records the respawn point on entering an O-O-O map; the client sends none", () => {
    const seed = testMap("x1000y992");
    const inn = testMap("x1001y992");
    inn.flags.canFight = "O";
    inn.flags.isIndoors = "O";
    inn.flags.canPvp = "O";
    const { world, join } = setup([seed, inn]);
    const p = player("Al", seed, 6, 4);
    join(p);
    expect(p.char.respawn).toBeNull();
    warp(world, p, inn, 3, 7, NO_CASINO);
    expect(p.char.respawn).toEqual({ mapId: inn.id, x: 3, y: 7 });
    // A map that is not O-O-O leaves it.
    warp(world, p, seed, 6, 4, NO_CASINO);
    expect(p.char.respawn).toEqual({ mapId: inn.id, x: 3, y: 7 });
    // No client message can name it: the death-map write has no schema.
    expect(inGameSchema.safeParse({ t: "writeDeathMap", map: "x1y1" }).success).toBe(false);
  });

  test("kept bug: the seed map and new-map defaults do not save a respawn point; death without one uses the configured fallback", () => {
    const isOoo = (f: { canFight: string; isIndoors: string; canPvp: string }) =>
      `${f.canFight}-${f.isIndoors}-${f.canPvp}`.toUpperCase().includes("O-O-O");
    const seed = findMapByCoords(db, 1000, 992);
    if (!seed) {
      throw new Error("seed map missing");
    }
    expect(isOoo(seed.flags)).toBe(false);
    expect(isOoo(blankMap(1001, 992).flags)).toBe(false);

    // Dying on a map with those flags sends the player to the setting's tile and stores no point.
    const start = testMap("x1000y992");
    const died = testMap("x1001y992");
    died.flags = { ...blankMap(1001, 992).flags };
    const byName = new Map([start, died].map((m) => [m.name, m]));
    const world = createWorld();
    const deps = {
      loadMap: (n: string) => byName.get(n) ?? null,
      startPoint: { map: "x1000y992", x: 6, y: 4 },
      casino: NO_CASINO,
      respawnPoint: defaultSettings().respawnPoint,
      saveIntervalTicks: 600,
      rng: rngByN({ 5: [1] }),
    };
    const p = player("Al", died, 9, 9);
    addPlayer(world, p);
    p.loading = 0;
    p.char.vitals.hp = 0;
    for (let i = 0; i < 28; i++) {
      tick(world, deps);
    }
    expect([p.map.name, p.x, p.y]).toEqual(["x1000y992", 5, 5]);
    expect(p.char.respawn).toBeNull();
  });
});
