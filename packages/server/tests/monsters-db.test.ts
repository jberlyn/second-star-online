/**
 * Persistence (real SQL on in-memory SQLite): the seed roster, monsters surviving a
 * restart, `/roster`, progress saves and the regen counter across a resumed session.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ServerMsg } from "@secondstaronline/shared";

import { runSetRole } from "../src/cli/set-role.ts";
import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { findCharacterById } from "../src/persistence/characters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadSlots } from "../src/persistence/monsters.ts";
import { rngByN } from "./helpers/sim.ts";

const NOW = "2026-11-05T00:00:00.000Z";
let db: Db;
let sent: { to: string; msg: ServerMsg }[];

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
});

function game(): Game {
  return createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => NOW,
    rng: rngByN(),
    minute: () => 0,
  });
}

async function makeChar(g: Game, name: string): Promise<string> {
  const r = await g.create({
    t: "create",
    name,
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
  if (!r.ok) {
    throw new Error(r.text);
  }
  const l = await g.login(name, "pw");
  if (!l.ok) {
    throw new Error(l.text);
  }
  return l.characterId;
}

const texts = (to: string) =>
  sent.flatMap((s) => (s.to === to && s.msg.t === "chat" ? [s.msg.text] : []));

describe("seed roster and map flags (migration 20261105_03)", () => {
  test("x1000y992 keeps its original roster, slot 1 Slime", () => {
    const m = findMapByCoords(db, 1000, 992);
    expect(m?.flags).toEqual({ canFight: "X", fctSpwn: "X", isIndoors: "X", canPvp: "X" });
    expect(loadSlots(db, m?.id ?? "").map((s) => s.species)).toEqual(["Slime", null, null, null]);
  });
});

describe("monsters survive a restart", () => {
  test("a damaged Slime comes back where it was, with its HP", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    const map = g.world.players.get(id)?.map;
    const slot = map?.slots[0];
    if (!slot) {
      throw new Error("no slot");
    }
    slot.live = {
      name: "Slime",
      hp: 5,
      x: 9,
      y: 3,
      facing: "W",
      anim: 0,
      fromX: 9,
      fromY: 3,
      queue: [],
      hitCountb: 0,
    };
    g.saveAll();
    const again = game();
    again.enter(id, false);
    const back = again.world.players.get(id)?.map.slots[0]?.live;
    expect(back).toMatchObject({ name: "Slime", hp: 5, x: 9, y: 3, facing: "W" });
    const snap = sent.find((s) => s.to === id && s.msg.t === "snapshot" && s.msg.monsters.length);
    expect(snap?.msg).toMatchObject({
      monsters: [{ slot: 1, name: "Slime", body: 30, x: 9, y: 3 }],
    });
  });
});

describe("/roster", () => {
  test("an immortal lists, sets and clears slots; the change is saved", async () => {
    const g = game();
    const id = await makeChar(g, "Gm");
    const acc = findCharacterById(db, id)?.accountId ?? "";
    setRole(db, acc, "immortal", NOW);
    g.enter(id, false);
    g.intent(id, { t: "chat", text: "/roster" });
    g.intent(id, { t: "chat", text: "/roster 2 orc lord" });
    g.intent(id, { t: "chat", text: "/roster 3 Dragon" });
    g.intent(id, { t: "chat", text: "/roster 1 clear" });
    g.intent(id, { t: "chat", text: "/roster 5 Slime" });
    expect(texts(id).slice(-5)).toEqual([
      "Roster of x1000y992: 1 Slime, 2 (empty), 3 (empty), 4 (empty)",
      "Roster slot 2 is now Orc Lord.",
      "Dragon has no artwork and cannot be placed.",
      "Roster slot 1 is now empty.",
      "Usage: /roster, /roster <1-4> <monster>, /roster <1-4> clear",
    ]);
    const m = findMapByCoords(db, 1000, 992);
    expect(loadSlots(db, m?.id ?? "").map((s) => s.species)).toEqual([
      null,
      "Orc Lord",
      null,
      null,
    ]);
  });

  test("anyone else just says it, as 1.6 would", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    g.enter(id, false);
    g.intent(id, { t: "chat", text: "/roster 1 clear" });
    expect(texts(id).at(-1)).toBe('Bob says "/roster 1 clear"');
  });

  test("bun run admin:role makes an operator immortal", async () => {
    const path = join(tmpdir(), `sso-role-${process.pid}-${Date.now()}.sqlite`);
    const file = openDatabase(path);
    migrate(file);
    db = file;
    await makeChar(game(), "Op");
    file.close();
    expect(runSetRole(path, "op", "immortal")).toBe("Op is now immortal.");
    expect(() => runSetRole(path, "nobody", "immortal")).toThrow(/no account/);
    expect(() => runSetRole(path, "Op", "king")).toThrow(/role must be/);
    await Bun.file(path).delete();
  });
});

describe("progress saves", () => {
  test("vitals, XP, hunger and skills are written and read back", async () => {
    const g = game();
    const id = await makeChar(g, "Cara");
    g.enter(id, false);
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in world");
    }
    p.char.vitals.exp = 23;
    p.char.vitals.hp = 7;
    p.char.hunger = 41234;
    p.char.skills[28] = 5; // Punch
    g.leave(id);
    const c = findCharacterById(db, id);
    expect(c?.vitals).toMatchObject({ exp: 23, hp: 7 });
    expect(c?.hunger).toBe(41234);
    const again = game();
    again.enter(id, false);
    expect(again.world.players.get(id)?.char.skills[28]).toBe(5);
  });

  test("a resumed session keeps the regen counter; a login resets it", async () => {
    const g = game();
    const id = await makeChar(g, "Dee");
    g.enter(id, false);
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in world");
    }
    p.regenCounter = 100;
    g.leave(id);
    g.enter(id, true);
    expect(g.world.players.get(id)?.regenCounter).toBe(100);
    g.leave(id);
    g.enter(id, false);
    expect(g.world.players.get(id)?.regenCounter).toBe(1);
  });
});
