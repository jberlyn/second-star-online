/**
 * The World Editor on the server and exits in play, with seeded tick replays and real SQL.
 */
import { describe, expect, test } from "bun:test";

import { blankMap, EDGE_BLOCKED_TEXT, NO_FOG } from "@secondstaronline/shared";

import { openDatabase } from "../src/persistence/database.ts";
import {
  countMapVersions,
  findMapByCoords,
  insertMapVersion,
  saveMap,
} from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadSlots, saveSlots } from "../src/persistence/monsters.ts";
import {
  applySave,
  closeEditor,
  editorView,
  openEditor,
  saveError,
} from "../src/systems/admin/worldedit.ts";
import { species } from "../src/systems/monsters/slots.ts";
import { exitUnder } from "../src/systems/world/tick.ts";
import { player, setup, testMap } from "./helpers/sim.ts";

describe("exits", () => {
  test("standing on an Exit warps to exit 1; Exit2 to exit 2", () => {
    const a = testMap("x1000y992");
    const b = testMap("x1001y992");
    a.exit1 = { mx: 1001, my: 992, x: 3, y: 4 };
    a.exit2 = { mx: 1001, my: 992, x: 10, y: 11 };
    a.ground.push({ id: "e1", item: "Exit", x: 5, y: 5, kind: "admin", expiresAt: null });
    a.ground.push({ id: "e2", item: "exit2", x: 7, y: 5, kind: "admin", expiresAt: null });
    const { world, join, run } = setup([a, b]);
    const p = player("p", a, 5, 5);
    const q = player("q", a, 7, 5);
    join(p);
    join(q);
    run(1);
    expect([p.map.name, p.x, p.y]).toEqual(["x1001y992", 3, 4]);
    expect([q.map.name, q.x, q.y]).toEqual(["x1001y992", 10, 11]);
    expect(world.rooms.get("x1000y992")).toBeUndefined();
  });

  test("no exit mid-step, while loading or locked (sprite 112 must be on the item's loc)", () => {
    const a = testMap("x1000y992");
    a.ground.push({ id: "e1", item: "Exit", x: 5, y: 5, kind: "admin", expiresAt: null });
    const p = player("p", a, 5, 5);
    p.stepFrames = 3;
    expect(exitUnder(p)).toBeNull();
    p.stepFrames = 0;
    p.loading = 10;
    expect(exitUnder(p)).toBeNull();
    p.loading = 0;
    p.keyLock = true;
    expect(exitUnder(p)).toBeNull();
    p.keyLock = false;
    expect(exitUnder(p)).toBe("Exit");
  });

  test("bug fixed: an exit with no target, or to a missing map, leaves you on it and says so once", () => {
    for (const exit1 of [null, { mx: 77, my: 77, x: 5, y: 5 }]) {
      const a = testMap("x1000y992");
      a.exit1 = exit1;
      a.ground.push({ id: "e1", item: "Exit", x: 2, y: 2, kind: "admin", expiresAt: null });
      const { join, run } = setup([a], { map: "x1000y992", x: 6, y: 4 });
      const p = player("p", a, 2, 2);
      join(p);
      const out = run(3);
      expect([p.map.name, p.x, p.y]).toEqual(["x1000y992", 2, 2]);
      const lines = out.flatMap((o) => (o.to === "p" && o.msg.t === "chat" ? [o.msg.text] : []));
      expect(lines).toEqual([EDGE_BLOCKED_TEXT]);
    }
  });
});

describe("opening, saving and closing", () => {
  test("a player cannot open the editor; an immortal leaves the room and stops ticking", () => {
    const a = testMap("x1000y992");
    const { world, join, run } = setup([a]);
    const p = player("p", a, 5, 5);
    const imm = player("imm", a, 6, 6);
    imm.role = "immortal";
    join(p);
    join(imm);
    const casino = { graceTicks: 600, addGoldOffline: () => {} };
    expect(openEditor(world, p, () => a, { mx: 1000, my: 992 }, casino)).toEqual([]);
    const out = openEditor(world, imm, () => a, { mx: 1000, my: 992 }, casino);
    expect(out.some((o) => o.to === "p" && o.msg.t === "delta")).toBe(true);
    expect(out.some((o) => o.to === "imm" && o.msg.t === "editor")).toBe(true);
    expect(world.rooms.get("x1000y992")?.players).toEqual([p]);
    imm.char.hunger = 100;
    run(5);
    expect(imm.char.hunger).toBe(100);
    const back = closeEditor(world, imm);
    expect(back.some((o) => o.to === "imm" && o.msg.t === "snapshot")).toBe(true);
    expect(imm.flicker).toBe(40); // the flicker on entry
    expect([imm.x, imm.y]).toEqual([6, 6]);
  });

  test("save: the placed monsters become the roster and live monsters at full HP; loot stays", () => {
    const a = testMap("x1000y992");
    a.ground.push({ id: "loot", item: "Apple", x: 1, y: 1, kind: "loot", expiresAt: 1 });
    a.ground.push({ id: "old", item: "Sign 2", x: 2, y: 2, kind: "admin", expiresAt: null });
    const { world, join } = setup([a]);
    const p = player("p", a, 5, 5);
    join(p);
    const m = editorView(a, 1000, 992);
    m.mobs = [null, { name: "slime", x: 4, y: 4 }, null, null];
    m.items = [{ name: "Exit", x: 3, y: 3 }];
    m.signs = ["", "Hello", ""];
    let n = 0;
    const r = applySave(world, a, m, () => `new${n++}`);
    expect(a.slots[1]?.species).toBe("Slime");
    expect(a.slots[1]?.home).toEqual({ x: 4, y: 4 });
    // `name:HP:x:y` with the species' HP.
    expect(a.slots[1]?.live).toMatchObject({ name: "Slime", hp: species("Slime")?.hp, x: 4, y: 4 });
    expect(a.slots[0]?.species).toBeNull();
    expect(r.removed).toEqual(["old"]);
    expect(a.ground.map((g) => g.id)).toEqual(["loot", "new0"]);
    expect(a.signs[1]).toBe("Hello");
    expect(r.out.some((o) => o.to === "p" && o.msg.t === "snapshot")).toBe(true);
  });

  test("placed items take /drop's names; a counted pile round-trips", () => {
    const a = testMap("x1000y992");
    const { world } = setup([a]);
    const m = editorView(a, 1000, 992);
    m.items = [{ name: "Blue Crystal", x: 3, y: 3 }];
    expect(saveError(m)).not.toBeNull();
    m.items = [{ name: "20 Apple", x: 3, y: 3 }];
    expect(saveError(m)).toBeNull();
    applySave(world, a, m, () => "pile");
    expect(a.ground).toMatchObject([{ id: "pile", item: "Apple", qty: 20, kind: "admin" }]);
    expect(editorView(a, 1000, 992).items).toEqual([{ name: "20 Apple", x: 3, y: 3 }]);
  });

  test("the editor shows a /roster slot without a tile on row 1 under its slot number", () => {
    const a = testMap("x1000y992");
    if (a.slots[2]) {
      a.slots[2].species = "Wolf";
    }
    expect(editorView(a, 1000, 992).mobs[2]).toEqual({ name: "Wolf", x: 3, y: 1 });
  });
});

describe("persistence (real SQL)", () => {
  test("a map round-trips exits, signs, fog and header; versions are kept", () => {
    const db = openDatabase();
    migrate(db);
    const b = blankMap(5, -2);
    const id = saveMap(
      db,
      {
        mx: 5,
        my: -2,
        title: "Cave",
        layers: b.layers,
        flags: b.flags,
        exit1: { mx: 1, my: 2, x: 3, y: 4 },
        exit2: null,
        signs: ["a", "b", "c"],
        fog: { tex: "Whispy", blend: 120, r: 1, g: 2, b: 3 },
      },
      "2026-11-06T00:00:00.000Z",
    );
    const rec = findMapByCoords(db, 5, -2);
    expect(rec?.id).toBe(id);
    expect(rec?.exit1).toEqual({ mx: 1, my: 2, x: 3, y: 4 });
    expect(rec?.exit2).toBeNull();
    expect(rec?.signs).toEqual(["a", "b", "c"]);
    expect(rec?.fog).toEqual({ tex: "Whispy", blend: 120, r: 1, g: 2, b: 3 });
    expect(rec?.title).toBe("Cave");
    // The seed map has the defaults.
    expect(findMapByCoords(db, 1000, 992)?.fog).toEqual(NO_FOG);
    const again = saveMap(
      db,
      { ...rec!, fog: NO_FOG, exit1: null, exit2: null, signs: ["", "", ""] },
      "2026-11-06T00:00:01.000Z",
    );
    expect(again).toBe(id);
    insertMapVersion(db, { mapId: id, savedBy: "acc", data: { title: "Cave" } }, "now");
    expect(countMapVersions(db, id)).toBe(1);
  });

  test("a slot's editor tile round-trips (map_slots.home_x/home_y)", () => {
    const db = openDatabase();
    migrate(db);
    const id = findMapByCoords(db, 1000, 992)?.id as string;
    saveSlots(db, id, [{ slot: 1, species: "Slime", live: null, home: { x: 4, y: 7 } }], "now");
    expect(loadSlots(db, id)[0]?.home).toEqual({ x: 4, y: 7 });
    expect(loadSlots(db, id)[1]?.home).toBeNull();
  });
});
