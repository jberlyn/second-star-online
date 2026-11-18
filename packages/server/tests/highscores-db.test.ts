/**
 * High-score persistence (real SQL on in-memory SQLite): the `high_scores` rows (migration
 * 20261107_21) round-trip in rank order, a changed table is written by the flush and reloaded on
 * boot.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadHighScores, saveHighScores } from "../src/persistence/highscores.ts";
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
