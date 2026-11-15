/**
 * Casino persistence (real SQL on in-memory SQLite): the `high_scores` rows (migration
 * 20261107_21) round-trip in rank order, a changed table is written by the flush and reloaded on
 * boot.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadHighScores, saveHighScores } from "../src/persistence/highscores.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { bjBid, bjSit } from "../src/systems/casino/blackjack.ts";
import type { GroundItem } from "../src/systems/world/world.ts";
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

describe("high_scores rows (migration 20261107_21)", () => {
  test("starts empty (1.6's empty high-score file); a table round-trips in rank order", () => {
    expect(loadHighScores(db)).toEqual([]);
    const table = [
      { id: "b", name: "Bo", points: 90 },
      { id: "a", name: "Al", points: 40 },
      { id: "c", name: "Cy", points: 7 },
    ];
    db.transaction(() => saveHighScores(db, table))();
    expect(loadHighScores(db)).toEqual(table);
    db.transaction(() => saveHighScores(db, [{ id: "a", name: "Al", points: 41 }]))();
    expect(loadHighScores(db)).toEqual([{ id: "a", name: "Al", points: 41 }]);
  });

  test("rank is limited to 1-10", () => {
    expect(() =>
      db
        .query(
          "INSERT INTO high_scores (rank, character_id, name, points) VALUES (11, 'x', 'X', 1)",
        )
        .run(),
    ).toThrow();
  });

  test("a dirty table is written by the flush and reloaded on boot", () => {
    const g = game();
    g.world.highScores = [{ id: "a", name: "Al", points: 55 }];
    g.world.highScoresDirty = true;
    g.tick();
    expect(g.world.highScoresDirty).toBe(false);
    expect(loadHighScores(db)).toEqual([{ id: "a", name: "Al", points: 55 }]);
    expect(game().world.highScores).toEqual([{ id: "a", name: "Al", points: 55 }]);
  });
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

describe("blackjack gold on disk", () => {
  test("a flush mid-hand writes gold + the held stake; a forfeit past the grace moves the stake in SQL", async () => {
    const g = game();
    const al = await makeChar(g, "Alice");
    const bo = await makeChar(g, "Bob");
    g.enter(al, false);
    g.enter(bo, false);
    const a = g.world.players.get(al);
    const b = g.world.players.get(bo);
    if (!a || !b) {
      throw new Error("not entered");
    }
    const table: GroundItem = {
      id: "t",
      item: "Blackjack Table",
      x: a.x + 1,
      y: a.y,
      kind: "drop",
      expiresAt: null,
    };
    b.x = a.x + 2;
    b.y = a.y;
    a.char.gold = 100;
    b.char.gold = 100;
    const rng = rngByN();
    bjSit(g.world, a, table);
    bjSit(g.world, b, table);
    bjBid(g.world, a, "50", rng);
    bjBid(g.world, b, "30", rng);
    expect([a.char.gold, b.char.gold]).toEqual([70, 70]);
    g.tick();
    expect(loadInventory(db, al).gold).toBe(100);
    expect(loadInventory(db, bo).gold).toBe(100);
    g.leave(bo);
    expect(loadInventory(db, bo).gold).toBe(100);
    for (let i = 0; i < 700; i += 1) {
      g.tick();
    }
    expect(loadInventory(db, bo).gold).toBe(70);
    expect(a.char.gold).toBe(130);
    expect(loadInventory(db, al).gold).toBe(130);
    expect([...g.world.casinoTables.values()].map((t) => t.seats[1])).toEqual([null]);
  });
});
