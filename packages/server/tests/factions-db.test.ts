/**
 * Faction persistence (real SQL on in-memory SQLite): the faction powers and quest lines
 * are seeded from the original's data and survive a restart; a character's faction, count and
 * wanted flag load and save; a quest turn-in writes the bag and the rerolled line together; a
 * pardon is written at once.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadFactionPowers, loadQuestLines } from "../src/persistence/social.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
});

const game = (rolls: Record<number, number[]> = {}): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => "2026-11-07T00:00:00.000Z",
    rng: rngByN(rolls),
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

const column = (id: string) =>
  db
    .query<{ faction: number; faction_count: number; wanted: number }, [string]>(
      "SELECT faction, faction_count, wanted FROM characters WHERE id = ?",
    )
    .get(id);

describe("faction and quest persistence (migration 20261107_14)", () => {
  test("the first start seeds the archive's powers and quest lines", () => {
    expect(loadFactionPowers(db)).toBeNull();
    game();
    expect(loadFactionPowers(db)).toEqual([27, 123, 0]);
    const lines = loadQuestLines(db);
    expect(lines?.length).toBe(40);
    expect(lines?.[0]).toBe("Edwin:scroll:Airship Deed");
    expect(lines?.[39]).toBe("");
  });

  test("a character's faction, count and flag load with its bonus and are saved", async () => {
    const g = game();
    const id = await makeChar(g, "Al");
    db.run("UPDATE characters SET faction = 2, faction_count = 5000, wanted = 1 WHERE id = ?", [
      id,
    ]);
    g.enter(id, false);
    const p = g.world.players.get(id);
    expect(p?.char.faction).toEqual({ id: 2, f1Bonus: 0, f2Bonus: 9, f3Bonus: 0 });
    expect(p?.char.factionCount).toBe(5000);
    expect(p?.char.wanted).toBe(true);
    if (p) {
      p.char.factionCount = 4000;
    }
    g.leave(id);
    expect(column(id)).toEqual({ faction: 2, faction_count: 4000, wanted: 1 });
  });

  test("a quest turn-in writes the bag and the rerolled line, which survive a restart", async () => {
    // The seed rerolls the archive's nameless ":Steel Key:Trumpet" first (43, 20, 20), then the
    // turn-in rerolls Stephie's line.
    let g = game({ 43: [1, 5], 20: [1, 1, 3, 9] });
    expect(g.world.questLines[2]).toBe("Water God:Dragon Wing:Fire Key");
    expect(loadQuestLines(db)?.[2]).toBe("Water God:Dragon Wing:Fire Key");
    const id = await makeChar(g, "Al");
    administrator(id);
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "chat", text: "/roster 1 Stephie" });
    g.intent(id, { t: "chat", text: "/spawn 1" });
    // Stephie stands on the faced tile; a Fishle goes into the bag.
    const p = g.world.players.get(id);
    const slot = p ? p.char.bag.findIndex((l) => l === null) : -1;
    if (p) {
      p.char.bag[slot] = { item: "Fishle", qty: 1 };
    }
    g.intent(id, { t: "give", slot: slot + 1 });
    expect(texts(id)).toContain(
      'Stephie says "Wow thanks, just what I needed. Here take this reward!"',
    );
    expect(loadInventory(db, id).bag.some((l) => l?.item === "Yellow Potion")).toBe(true);
    expect(loadQuestLines(db)?.[1]).toBe("Cril:Corn:Trumpet");
    g.leave(id);
    g = game();
    expect(g.world.questLines[1]).toBe("Cril:Corn:Trumpet");
  });

  test("/Pardon clears the flag and writes it at once", async () => {
    const g = game();
    const imm = await makeChar(g, "King");
    const bob = await makeChar(g, "Bob");
    administrator(imm);
    db.run("UPDATE characters SET wanted = 1 WHERE id = ?", [bob]);
    g.enter(imm, false);
    g.enter(bob, false);
    g.intent(imm, { t: "chat", text: "/Pardon bob" });
    expect(texts(imm)).toContain("Pardoning bob...");
    expect(texts(bob)).toContain("*** You have been pardoned by King.");
    expect(column(bob)?.wanted).toBe(0);
    // A player's /Pardon is an unknown command: only they are told, and nothing changes.
    db.run("UPDATE characters SET wanted = 1 WHERE id = ?", [bob]);
    const p = g.world.players.get(bob);
    if (p) {
      p.char.wanted = true;
    }
    sent.length = 0;
    g.intent(bob, { t: "chat", text: "/Pardon Bob" });
    expect(sent.filter((m) => m.msg.t === "chat").map((m) => m.to)).toEqual([bob]);
    expect(p?.char.wanted).toBe(true);
  });
});
