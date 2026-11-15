/**
 * Mail and board persistence (real SQL on in-memory SQLite): mail and board rows (migration
 * 20261107_19) and the game's mail send reaching an offline character.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { addPost, loadBoard } from "../src/persistence/boards.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { addMail, deleteMail, findCharacterByName, loadMail } from "../src/persistence/mail.ts";
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

const T = "2026-11-07T00:00:00.000Z";

describe("mail rows", () => {
  test("round-trip in order, sender stamped as given", async () => {
    const g = game();
    const al = await makeChar(g, "Al");
    const bo = await makeChar(g, "Bo");
    addMail(db, bo, { from: "Al", subject: "One", body: "a" }, T, 50);
    addMail(db, bo, { from: "Al", subject: "Two", body: "b" }, T, 50);
    addMail(db, al, { from: "Bo", subject: "Re", body: "c" }, T, 50);
    expect(loadMail(db, bo).map((m) => m.subject)).toEqual(["One", "Two"]);
    expect(loadMail(db, bo)[0]).toMatchObject({ from: "Al", body: "a" });
    expect(loadMail(db, al)).toHaveLength(1);
  });

  test("the box is cut to the cap, oldest first, per owner", async () => {
    const g = game();
    const al = await makeChar(g, "Al");
    const bo = await makeChar(g, "Bo");
    addMail(db, al, { from: "x", subject: "keep", body: "" }, T, 3);
    for (let i = 1; i <= 5; i++) {
      addMail(db, bo, { from: "Al", subject: `m${i}`, body: "" }, T, 3);
    }
    expect(loadMail(db, bo).map((m) => m.subject)).toEqual(["m3", "m4", "m5"]);
    expect(loadMail(db, al)).toHaveLength(1);
  });

  test("delete removes only the owner's own row", async () => {
    const g = game();
    const al = await makeChar(g, "Al");
    const bo = await makeChar(g, "Bo");
    addMail(db, al, { from: "Bo", subject: "a", body: "" }, T, 50);
    addMail(db, bo, { from: "Al", subject: "b", body: "" }, T, 50);
    const bobsId = loadMail(db, bo)[0]?.id ?? 0;
    deleteMail(db, al, bobsId);
    expect(loadMail(db, bo)).toHaveLength(1);
    deleteMail(db, bo, bobsId);
    expect(loadMail(db, bo)).toHaveLength(0);
    expect(loadMail(db, al)).toHaveLength(1);
  });

  test("a deleted character takes its mail with it", async () => {
    const g = game();
    const bo = await makeChar(g, "Bo");
    addMail(db, bo, { from: "Al", subject: "a", body: "" }, T, 50);
    db.query("DELETE FROM characters WHERE id = ?").run(bo);
    expect(db.query("SELECT COUNT(*) AS n FROM mail").get()).toEqual({ n: 0 });
  });

  test("names are found ignoring case, with the stored spelling", async () => {
    const g = game();
    const bo = await makeChar(g, "Bo");
    expect(findCharacterByName(db, "bO")).toEqual({ id: bo, name: "Bo" });
    expect(findCharacterByName(db, "Nobody")).toBeNull();
  });

  test("a send through the game reaches a character who is offline", async () => {
    const g = game();
    const al = await makeChar(g, "Al");
    const bo = await makeChar(g, "Bo");
    g.enter(al, false);
    const sender = g.world.players.get(al);
    if (sender) {
      sender.mailUi = true; // the mailbox was opened (a send needs one)
    }
    g.intent(al, { t: "mailSend", to: "bo", subject: "Hi", body: "Offline mail" });
    expect(loadMail(db, bo)).toEqual([{ id: 1, from: "Al", subject: "Hi", body: "Offline mail" }]);
    expect(sent.some((m) => m.to === al && m.msg.t === "mailSent")).toBe(true);
  });
});

describe("board rows", () => {
  test("posts per board in order, ignoring case in the board name", () => {
    addPost(db, "Town Square", "Al", "one", T, 200);
    addPost(db, "The Knights's Board", "Bo", "two", T, 200);
    addPost(db, "town square", "Bo", "three", T, 200);
    expect(loadBoard(db, "TOWN SQUARE")).toEqual([
      { author: "Al", body: "one" },
      { author: "Bo", body: "three" },
    ]);
    expect(loadBoard(db, "The Knights's Board")).toHaveLength(1);
    expect(loadBoard(db, "Empty")).toEqual([]);
  });

  test("a board is cut to the cap, the oldest dropped, other boards untouched", () => {
    addPost(db, "Other", "Al", "keep", T, 2);
    for (let i = 1; i <= 4; i++) {
      addPost(db, "Town Square", "Al", `p${i}`, T, 2);
    }
    expect(loadBoard(db, "Town Square").map((p) => p.body)).toEqual(["p3", "p4"]);
    expect(loadBoard(db, "Other")).toHaveLength(1);
  });
});
