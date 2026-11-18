/**
 * Buddies, profiles and medals through the real database: buddy rows per account and kept
 * across logins (1.6: one pref per server address shared by every character on that PC); the
 * profile written on closing your bio; the medals and their stat points saved with the
 * character.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { type ServerMsg, skillIndex } from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { loadBuddies, saveBuddies } from "../src/persistence/buddies.ts";
import { findCharacterById, loadSkills } from "../src/persistence/characters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

const NOW = "2026-11-07T00:00:00.000Z";
type Out = { to: string; msg: ServerMsg }[];

describe("buddies, profiles and medals (persistence)", () => {
  let db: Db;
  const sent: Out = [];
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent.length = 0;
  });

  const texts = (id: string) =>
    sent.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));
  const friends = (id: string) =>
    sent.flatMap((o) => (o.to === id && o.msg.t === "friends" ? [o.msg] : []));

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

  test("rows keep order and are replaced whole", async () => {
    const { make } = await gameWith();
    const a = await make("Alice");
    db.transaction(() => saveBuddies(db, a.accountId, ["Bob", "", "Cy"]))();
    expect(loadBuddies(db, a.accountId)).toEqual(["Bob", "", "Cy"]);
    db.transaction(() => saveBuddies(db, a.accountId, ["Zed"]))();
    expect(loadBuddies(db, a.accountId)).toEqual(["Zed"]);
  });

  test("divergence: the list follows the account across logins and fills the window at entry; others are untouched", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    const b = await make("Bob");
    game.enter(a.characterId, false);
    game.enter(b.characterId, false);
    game.intent(a.characterId, { t: "chat", text: "/friends add Bob" });
    expect(friends(a.characterId).at(-1)).toEqual({ t: "friends", names: ["Bob"] });
    game.leave(a.characterId);
    expect(loadBuddies(db, a.accountId)).toEqual(["Bob"]);
    expect(loadBuddies(db, b.accountId)).toEqual([]);

    // A second login (SSO accounts hold one character): frame 50 fills it.
    sent.length = 0;
    game.enter(a.characterId, false);
    expect(friends(a.characterId)).toEqual([{ t: "friends", names: ["Bob"] }]);
    sent.length = 0;
    game.leave(b.characterId);
    expect(friends(a.characterId)).toEqual([{ t: "friends", names: [] }]);
    // A resumed session refills it too.
    game.leave(a.characterId);
    sent.length = 0;
    game.enter(a.characterId, true);
    expect(friends(a.characterId)).toEqual([{ t: "friends", names: [] }]);
  });

  test("bug fixed: closing your own bio writes the profile as typed", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    expect(findCharacterById(db, a.characterId)?.profile).toBe("I have not edited my profile yet");
    game.enter(a.characterId, false);
    game.intent(a.characterId, { t: "profileSave", text: "Hello. Fish; please" });
    expect(findCharacterById(db, a.characterId)?.profile).toBe("Hello. Fish; please");
    sent.length = 0;
    game.intent(a.characterId, { t: "bioRequest", id: a.characterId });
    const bio = sent.find((o) => o.msg.t === "playerBio")?.msg;
    expect(bio).toMatchObject({ t: "playerBio", title: "Alice Star", own: true });
    expect(bio && "profile" in bio ? bio.profile : null).toBe("Hello. Fish; please");
  });

  test("a medal and its point come from the saved skill; the stored stats stay as allocated", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    game.enter(a.characterId, false);
    game.tick(); // the session's first tick records the skills
    const p = game.world.players.get(a.characterId);
    if (!p) {
      throw new Error("not in the world");
    }
    const sta = p.char.stats.sta;
    p.char.skills[skillIndex("Cooking")] = 90;
    game.tick();
    expect(texts(a.characterId)).toContain(
      "You have been awarded the silver spatula for being a master chef!",
    );
    // Leaving saves the skill; the stored stat stays as allocated.
    game.leave(a.characterId);
    const row = findCharacterById(db, a.characterId);
    expect(row?.stats.sta).toBe(sta);
    expect(loadSkills(db, a.characterId)[skillIndex("Cooking")]).toBe(90);
    // The next login reads the skill back: the medal shows and its point is added.
    game.enter(a.characterId, false);
    expect(game.world.players.get(a.characterId)?.char.stats.sta).toBe(sta);
    sent.length = 0;
    game.intent(a.characterId, { t: "bioRequest", id: a.characterId });
    const bio = sent.find((o) => o.msg.t === "playerBio")?.msg;
    expect(bio && "medals" in bio ? bio.medals : null).toEqual(["39"]);
  });
});
