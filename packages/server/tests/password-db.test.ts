/**
 * `Password=<new>` through the real database. 1.6 stored the new password in a client field and
 * echoed it; SSO changes the account's password on the server and never shows it.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];

describe("Password=", () => {
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
      isoNow: () => "2026-11-07T00:00:00.000Z",
      rng: NEVER_PUSH,
    });
    const make = async (name: string) => {
      const r = await game.create({
        t: "create",
        name,
        password: "oldpw",
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
      const l = await game.login(name, "oldpw");
      if (!l.ok) {
        throw new Error(l.text);
      }
      game.enter(l.characterId, false);
      return l;
    };
    return { game, make };
  }

  test("Password= changes the account password and never echoes it", async () => {
    const { game, make } = await gameWith();
    const alice = await make("Alice");
    const bob = await make("Bob");
    sent.length = 0;
    game.intent(alice.characterId, { t: "chat", text: "Password=newpass" });
    // The reply waits for the hash.
    expect(texts(alice.characterId)).toEqual([]);
    await Bun.sleep(400);
    expect(texts(alice.characterId)).toEqual(["Password has been changed."]);
    expect(texts(bob.characterId)).toEqual([]);
    expect(JSON.stringify(sent)).not.toContain("newpass");
    const old = await game.login("Alice", "oldpw");
    expect(old.ok).toBe(false);
    const fresh = await game.login("Alice", "newpass");
    expect(fresh.ok).toBe(true);
  });

  test("Password= removes adjacent and leading forbidden characters", async () => {
    const { game, make } = await gameWith();
    const alice = await make("Alice");
    game.intent(alice.characterId, { t: "chat", text: "Password= a  b" });
    await Bun.sleep(300);
    expect((await game.login("Alice", "a b")).ok).toBe(false);
    expect((await game.login("Alice", "ab")).ok).toBe(true);
  });

  test("an empty or 65-character Password= is refused", async () => {
    const { game, make } = await gameWith();
    const alice = await make("Alice");
    sent.length = 0;
    game.intent(alice.characterId, { t: "chat", text: "Password=" });
    expect(texts(alice.characterId)).toEqual(["Your password was not changed."]);
    sent.length = 0;
    game.leave(alice.characterId);
    game.enter(alice.characterId, false);
    sent.length = 0;
    game.intent(alice.characterId, { t: "chat", text: `Password=${"x".repeat(65)}` });
    expect(texts(alice.characterId)).toEqual(["Your password was not changed."]);
    await Bun.sleep(100);
    expect((await game.login("Alice", "oldpw")).ok).toBe(true);
  });
});
