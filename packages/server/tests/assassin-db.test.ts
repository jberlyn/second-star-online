/**
 * Assassin's game persistence (real SQL on in-memory SQLite): the game rows (migration
 * 20261107_15) round-trip and survive a restart; the menu message is the administrator's and silent
 * to anyone else; `/assassin` is plain chat for everyone; an end writes an offline winner's
 * prize into its stored bag.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { emptyAssassinState, type ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { loadAssassinState, saveAssassinState } from "../src/persistence/assassin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
});

const game = (): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => "2026-11-07T00:00:00.000Z",
    rng: rngByN(),
    minute: () => 0,
  });

async function makeChar(g: Game, name: string): Promise<string> {
  await g.create({
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
  const l = await g.login(name, "pw");
  if (!l.ok) {
    throw new Error(l.text);
  }
  return l.characterId;
}

const administrator = (id: string) => {
  const acc = db
    .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
    .get(id);
  setRole(db, acc?.account_id ?? "", "administrator", "2026-11-07T00:00:00.000Z");
};

const texts = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

describe("Assassin's game rows (migration 20261107_15)", () => {
  test("nothing seeded: STOP and empty tables; the state round-trips in order", async () => {
    expect(loadAssassinState(db)).toEqual(emptyAssassinState());
    const g = game();
    const a = await makeChar(g, "Al");
    const b = await makeChar(g, "Bo");
    const s = emptyAssassinState();
    s.mode = "LIGHTNING";
    s.current = [
      { id: b, name: "Bo", points: 30 },
      { id: a, name: "Al", points: 20 },
    ];
    s.legends = [{ id: a, name: "Al", points: 2 }];
    s.scores.set(a, 20).set(b, 30);
    s.wins.set(a, 2);
    db.transaction(() => saveAssassinState(db, s))();
    expect(loadAssassinState(db)).toEqual(s);
    expect(game().world.assassin).toEqual(s);
  });

  test("the menu message: an administrator starts a game, written at once; anyone else is silent and logged", async () => {
    const g = game();
    const imm = await makeChar(g, "King");
    const bob = await makeChar(g, "Bob");
    administrator(imm);
    g.enter(imm, false);
    g.enter(bob, false);
    sent = [];
    g.intent(bob, { t: "assassinGame", mode: "GO" });
    expect(texts(bob)).toEqual([]);
    expect(loadAssassinState(db).mode).toBe("STOP");
    expect(db.query("SELECT name, reason FROM cheat_log").all()).toEqual([
      { name: "Bob", reason: "Attempted Admin Access" },
    ]);
    g.intent(imm, { t: "assassinGame", mode: "LIGHTNING" });
    expect(texts(bob)).toContain("*** 1 hit is 1 kill and all death penalties are OFF!");
    expect(loadAssassinState(db).mode).toBe("LIGHTNING");
  });

  test("SSO: '/assassin end' from an administrator is an unknown command: it is gone, the Admin menu's End Assassin's Game is the way", async () => {
    const g = game();
    const imm = await makeChar(g, "King");
    const bob = await makeChar(g, "Bob");
    administrator(imm);
    g.enter(imm, false);
    g.enter(bob, false);
    g.intent(imm, { t: "mapReady" });
    g.intent(bob, { t: "mapReady" });
    g.intent(imm, { t: "assassinGame", mode: "GO" });
    expect(loadAssassinState(db).mode).toBe("GO");
    sent = [];
    g.intent(imm, { t: "chat", text: "/assassin end" });
    expect(loadAssassinState(db).mode).toBe("GO");
    expect(texts(bob).some((t) => t.includes("/assassin end"))).toBe(false);
    expect(texts(imm)).toContain('Unknown command "/assassin".');
  });

  test("an end writes an offline winner's prize into its stored bag", async () => {
    const g = game();
    const imm = await makeChar(g, "King");
    const al = await makeChar(g, "Al");
    administrator(imm);
    g.enter(imm, false);
    g.intent(imm, { t: "assassinGame", mode: "GO" });
    g.world.assassin.current = [{ id: al, name: "Al", points: 10 }];
    g.intent(imm, { t: "assassinGame", mode: "STOP" });
    expect(texts(imm)).toContain("*** Al has won first place with 10 points!");
    expect(loadInventory(db, al).bag.some((l) => l?.item === "Long Sword")).toBe(true);
    const s = loadAssassinState(db);
    expect(s.mode).toBe("STOP");
    expect(s.wins.get(al)).toBe(1);
    expect(s.legends).toEqual([{ id: al, name: "Al", points: 1 }]);
  });
});
