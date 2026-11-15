/**
 * Ignore lists through the real database: per account, kept across logins, in order with
 * duplicates (1.6 emptied the list at login).
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadIgnores, saveIgnores } from "../src/persistence/ignores.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

const NOW = "2026-11-07T00:00:00.000Z";
type Out = { to: string; msg: ServerMsg }[];

describe("ignores (persistence/ignores.ts)", () => {
  let db: Db;
  const sent: Out = [];
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent.length = 0;
  });

  const texts = (id: string) =>
    sent.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));

  async function gameWith() {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => NOW,
      rng: NEVER_PUSH,
    });
    const make = async (name: string) => {
      const r = await game.create({
        t: "create",
        name,
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      });
      expect(r).toEqual({ ok: true });
      const l = await game.login(name, "pw");
      if (!l.ok) {
        throw new Error(l.text);
      }
      return l;
    };
    return { game, make };
  }

  test("rows keep order and duplicates, and are replaced whole", async () => {
    const { make } = await gameWith();
    const a = await make("Alice");
    db.transaction(() => saveIgnores(db, a.accountId, ["Bob", "bob", ""]))();
    expect(loadIgnores(db, a.accountId)).toEqual(["Bob", "bob", ""]);
    db.transaction(() => saveIgnores(db, a.accountId, ["Zed"]))();
    expect(loadIgnores(db, a.accountId)).toEqual(["Zed"]);
  });

  test("the list follows the account across logins; other accounts are untouched", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    const b = await make("Bob");
    game.enter(a.characterId, false);
    game.enter(b.characterId, false);
    game.intent(a.characterId, { t: "chat", text: "/ignore Bob" });
    game.leave(a.characterId);
    expect(loadIgnores(db, a.accountId)).toEqual(["Bob"]);
    expect(loadIgnores(db, b.accountId)).toEqual([]);

    sent.length = 0;
    game.enter(a.characterId, false);
    game.intent(b.characterId, { t: "chat", text: "hello" });
    expect(texts(a.characterId)).not.toContain('Bob says "hello"');
    game.intent(a.characterId, { t: "chat", text: "/ignorelist" });
    expect(texts(a.characterId).slice(-3)).toEqual(["*** Your Ignore List ", "Bob", ""]);
  });

  test("a resumed session keeps its away text; a login starts off", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    const b = await make("Bob");
    game.enter(a.characterId, false);
    game.enter(b.characterId, false);
    game.intent(b.characterId, { t: "away", text: "brb" });
    game.leave(b.characterId);
    game.enter(b.characterId, true);
    sent.length = 0;
    game.intent(a.characterId, { t: "im", to: "Bob", text: "hi", via: "send" });
    expect(sent.filter((o) => o.msg.t === "im").map((o) => o.msg)).toEqual([
      { t: "im", from: "Alice", text: "hi", away: true },
      { t: "im", from: "Bob", text: "brb", away: false },
    ]);
    game.leave(b.characterId);
    game.enter(b.characterId, false);
    sent.length = 0;
    // Alice's chat cooldown (60 frames) runs out first.
    for (let i = 0; i < 61; i++) {
      game.tick();
    }
    game.intent(a.characterId, { t: "im", to: "Bob", text: "again", via: "send" });
    expect(sent.filter((o) => o.msg.t === "im").map((o) => o.msg)).toEqual([
      { t: "im", from: "Alice", text: "again", away: false },
    ]);
  });

  test("a resumed session takes back its room; logging off leaves it", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    const b = await make("Bob");
    game.enter(a.characterId, false);
    game.enter(b.characterId, false);
    game.intent(a.characterId, { t: "roomEnter", room: "general" });
    game.intent(b.characterId, { t: "roomEnter", room: "general" });
    sent.length = 0;
    game.leave(b.characterId);
    expect(sent.filter((o) => o.msg.t === "roomUser").map((o) => o.msg)).toEqual([
      { t: "roomUser", name: "Bob", on: false },
    ]);
    sent.length = 0;
    game.enter(b.characterId, true);
    expect(
      sent.filter((o) => o.msg.t === "roomUser" || o.msg.t === "room").map((o) => o.msg),
    ).toEqual([{ t: "roomUser", name: "Bob", on: true }]);
  });
});
