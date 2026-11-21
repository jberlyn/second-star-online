/**
 * Per-account player preferences, ignore list sync, Who's Online opener, and server-side
 * enforcement of NPC chatter, presence chat lines, and Social & privacy rules.
 */
import { describe, expect, test } from "bun:test";

import {
  ADMINISTRATOR,
  PRIVACY_TEXT,
  presetBindings,
  rebindKey,
  type ServerMsg,
  startingCharacter,
} from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { hashPassword, insertAccount, setRole } from "../src/persistence/accounts.ts";
import { insertCharacter } from "../src/persistence/characters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";
import {
  loadAccountPreferences,
  loadAccountPreferencesRecord,
  saveAccountPreferences,
} from "../src/persistence/preferences.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import { chatterOut } from "../src/systems/monsters/npc.ts";
import { NEVER_PUSH, player, setup, testMap } from "./helpers/sim.ts";

const NOW = "2026-11-21T10:00:00.000Z";
const HASH = await hashPassword("secret");

const texts = (sent: { to: string; msg: ServerMsg }[], id: string) =>
  sent.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));

async function makeWorld() {
  const db: Db = openDatabase();
  migrate(db);
  const sent: { to: string; msg: ServerMsg }[] = [];
  const game = createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => NOW,
    rng: NEVER_PUSH,
  });
  const mapRow = db
    .query<{ id: string }, []>("SELECT id FROM maps WHERE mx = 1000 AND my = 992")
    .get() as { id: string };
  const make = (name: string, role: string | null = null) => {
    const account = insertAccount(db, { username: name, passwordHash: HASH, now: NOW });
    if (role) {
      setRole(db, account.id, role, NOW);
    }
    const characterId = insertCharacter(db, {
      accountId: account.id,
      start: startingCharacter({
        name,
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      }),
      position: { mapId: mapRow.id, x: 5, y: 5, facing: "S" },
      now: NOW,
    });
    return { accountId: account.id, characterId };
  };
  return { db, sent, game, make };
}

describe("account preferences persistence & migration", () => {
  test("migration 47 cleans up legacy presence server settings from upgraded DBs and creates account_preferences", () => {
    const db = openDatabase();
    const all = loadMigrations();
    const idx47 = all.findIndex((m) => m.name === "20261121_47_account_preferences.sql");
    expect(idx47).toBeGreaterThan(0);
    // Migrate through 46, seed the removed legacy overrides, then apply 47+ via the real migrator.
    runMigrations(db, all.slice(0, idx47));
    saveSettingOverride(db, "announcePresence", false, NOW);
    saveSettingOverride(db, "presenceChatLines", true, NOW);
    expect(
      db
        .query("SELECT key FROM settings WHERE key IN ('announcePresence', 'presenceChatLines')")
        .all(),
    ).toHaveLength(2);

    runMigrations(db, all.slice(idx47));
    expect(
      db
        .query("SELECT key FROM settings WHERE key IN ('announcePresence', 'presenceChatLines')")
        .all(),
    ).toEqual([]);

    const acc = insertAccount(db, { username: "Alice", passwordHash: HASH, now: NOW });
    expect(loadAccountPreferencesRecord(db, acc.id).stored).toBe(false);
    const custom = {
      ...loadAccountPreferences(db, acc.id),
      controlSet: "custom" as const,
      keyBindings: rebindKey(presetBindings("modern"), "attack", 0, "KeyQ").next,
      chatTimestamps: true,
      colorblindBars: true,
    };
    saveAccountPreferences(db, acc.id, custom, NOW);
    expect(loadAccountPreferencesRecord(db, acc.id)).toEqual({ prefs: custom, stored: true });
  });

  test("prefsSave persists per account, replies prefsResult, and reloads on next login", async () => {
    const { sent, game, make } = await makeWorld();
    const alice = make("Alice");
    game.enter(alice.characterId, false);
    const initial = sent.find((o) => o.to === alice.characterId && o.msg.t === "prefs")?.msg;
    expect(initial?.t === "prefs" && initial.stored).toBe(false);

    sent.length = 0;
    game.intent(alice.characterId, {
      t: "prefsSave",
      requestId: 7,
      prefs: {
        chatTextSize: "large",
        masterVolume: 55,
        colorblindBars: true,
      },
    });
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: expect.objectContaining({
        t: "prefsResult",
        ok: true,
        text: "Settings saved.",
        requestId: 7,
      }),
    });
    const pushed = sent.find((o) => o.to === alice.characterId && o.msg.t === "prefs")?.msg;
    expect(pushed?.t === "prefs" && pushed.prefs.chatTextSize).toBe("large");
    expect(pushed?.t === "prefs" && pushed.prefs.masterVolume).toBe(55);
    expect(pushed?.t === "prefs" && pushed.stored).toBe(true);

    // Unchanged save skips redundant `prefs` broadcast and still acknowledges with `prefsResult`.
    sent.length = 0;
    game.intent(alice.characterId, {
      t: "prefsSave",
      requestId: 8,
      prefs: { masterVolume: 55 },
    });
    expect(sent.some((o) => o.msg.t === "prefs")).toBe(false);
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: expect.objectContaining({ t: "prefsResult", ok: true, requestId: 8 }),
    });

    // Re-login reloads the persisted preferences from the account row with stored=true.
    game.leave(alice.characterId);
    sent.length = 0;
    game.enter(alice.characterId, false);
    const reloaded = sent.find((o) => o.to === alice.characterId && o.msg.t === "prefs")?.msg;
    expect(reloaded?.t === "prefs" && reloaded.stored).toBe(true);
    expect(reloaded?.t === "prefs" && reloaded.prefs.colorblindBars).toBe(true);
    expect(reloaded?.t === "prefs" && reloaded.prefs.masterVolume).toBe(55);
  });

  test("ignoreAdd trims/validates and ignoreRemove can delete long entries added via /ignore", async () => {
    const { sent, game, make } = await makeWorld();
    const alice = make("Alice");
    game.enter(alice.characterId, false);
    sent.length = 0;

    game.intent(alice.characterId, { t: "ignoreAdd", name: "  Spammer  " });
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: expect.objectContaining({ t: "ignores", list: ["Spammer"], ok: true }),
    });

    // Blank/whitespace-only add returns a friendly error without storing junk.
    sent.length = 0;
    game.intent(alice.characterId, { t: "ignoreAdd", name: "   " });
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: expect.objectContaining({ t: "ignores", list: ["Spammer"], ok: false }),
    });

    // `/unignore` via chat also pushes the live `ignores` list.
    sent.length = 0;
    game.intent(alice.characterId, { t: "chat", text: "/unignore Spammer" });
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: { t: "ignores", list: [] },
    });

    // Long entry added through `/ignore` (over NAME_MAX) can still be removed via ignoreRemove.
    const longEntry = "LongNameAddedThroughChatCommand12345";
    game.intent(alice.characterId, { t: "chat", text: `/ignore ${longEntry}` });
    sent.length = 0;
    game.intent(alice.characterId, { t: "ignoreRemove", name: longEntry });
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: expect.objectContaining({ t: "ignores", list: [], ok: true }),
    });
  });

  test("whoOpen sends the Who's Online list without printing a chat line", async () => {
    const { sent, game, make } = await makeWorld();
    const alice = make("Alice");
    const bob = make("Bob");
    game.enter(alice.characterId, false);
    game.enter(bob.characterId, false);
    sent.length = 0;

    game.intent(alice.characterId, { t: "whoOpen" });
    expect(sent).toEqual([{ to: alice.characterId, msg: { t: "who", names: ["Alice", "Bob"] } }]);
  });
});

describe("Social & privacy and NPC chatter enforcement", () => {
  test("imFrom=friends blocks strangers with a notice, allows friends, and always allows staff", async () => {
    const { sent, game, make } = await makeWorld();
    const alice = make("Alice");
    const bob = make("Bob");
    const admin = make("Admin", ADMINISTRATOR.id);
    game.enter(alice.characterId, false);
    game.enter(bob.characterId, false);
    game.enter(admin.characterId, false);

    game.intent(alice.characterId, { t: "prefsSave", prefs: { imFrom: "friends" } });
    sent.length = 0;

    // Bob (stranger) is refused and told why.
    game.intent(bob.characterId, { t: "im", to: "Alice", text: "hey", via: "send" });
    expect(texts(sent, bob.characterId)).toContain(PRIVACY_TEXT.imFriendsOnly("Alice"));
    expect(sent.some((o) => o.to === alice.characterId && o.msg.t === "im")).toBe(false);

    // Staff can always message Alice even if not on her Friend's List.
    sent.length = 0;
    game.intent(admin.characterId, { t: "im", to: "Alice", text: "staff check", via: "send" });
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: { t: "im", from: "Admin", text: "staff check", away: false },
    });

    // Once Alice adds Bob to her friends, Bob's IM goes through (after Bob's 3s chat cooldown).
    game.intent(alice.characterId, { t: "chat", text: "/friends add Bob" });
    for (let i = 0; i < 65; i++) {
      game.tick();
    }
    sent.length = 0;
    game.intent(bob.characterId, { t: "im", to: "Alice", text: "hi friend", via: "send" });
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: { t: "im", from: "Bob", text: "hi friend", away: false },
    });
  });

  test("tradeFrom blocks strangers or everyone and informs the requester", async () => {
    const { sent, game, make } = await makeWorld();
    const alice = make("Alice");
    const bob = make("Bob");
    game.enter(alice.characterId, false);
    game.enter(bob.characterId, false);

    game.intent(alice.characterId, { t: "prefsSave", prefs: { tradeFrom: "none" } });
    sent.length = 0;
    game.intent(bob.characterId, { t: "tradeOpen", id: alice.characterId });
    expect(texts(sent, bob.characterId)).toEqual([PRIVACY_TEXT.tradeNone("Alice")]);
    expect(sent.some((o) => o.msg.t === "trade")).toBe(false);

    game.intent(alice.characterId, { t: "prefsSave", prefs: { tradeFrom: "friends" } });
    sent.length = 0;
    game.intent(bob.characterId, { t: "tradeOpen", id: alice.characterId });
    expect(texts(sent, bob.characterId)).toEqual([PRIVACY_TEXT.tradeFriendsOnly("Alice")]);

    game.intent(alice.characterId, { t: "chat", text: "/friends add Bob" });
    sent.length = 0;
    game.intent(bob.characterId, { t: "tradeOpen", id: alice.characterId });
    expect(sent.some((o) => o.to === bob.characterId && o.msg.t === "trade")).toBe(true);

    // If Alice switches Trade requests to No one before Bob sends the first offer, the offer is
    // refused, Bob's draft trade closes, and Alice never receives a trade window.
    game.intent(alice.characterId, { t: "prefsSave", prefs: { tradeFrom: "none" } });
    sent.length = 0;
    game.intent(bob.characterId, { t: "tradeOffer", gold: 0, items: [] });
    expect(texts(sent, bob.characterId)).toEqual([PRIVACY_TEXT.tradeNone("Alice")]);
    expect(sent).toContainEqual({ to: bob.characterId, msg: { t: "trade", trade: null } });
    expect(sent.some((o) => o.to === alice.characterId && o.msg.t === "trade")).toBe(false);
  });

  test("guildInvitesFrom blocks strangers or everyone and tells the guild leader", async () => {
    const { sent, game, make } = await makeWorld();
    const alice = make("Alice");
    const bob = make("Bob");
    game.enter(alice.characterId, false);
    game.enter(bob.characterId, false);
    // Give Bob a guild directly through the DB/world via guildCreate? Simpler: check via guildInvite unit!
    const map = testMap("x1000y992");
    const s = setup([map]);
    const leader = player("Bob", map, 5, 5);
    const target = player("Alice", map, 6, 5);
    s.join(leader);
    s.join(target);
    leader.guild = "Knights";
    s.world.guilds.set("knights", {
      id: "g1",
      name: "Knights",
      alignment: "G",
      colour: 0,
      leaderId: leader.id,
      leaderName: leader.name,
      members: [],
      disbanded: false,
      listedAt: 1,
      createdAt: NOW,
    });
    const { guildInvite } = await import("../src/systems/social/guilds.ts");

    target.prefs = { ...target.prefs, guildInvitesFrom: "none" };
    let out = guildInvite(s.world, leader, "Alice");
    expect(texts(out, leader.id)).toContain(PRIVACY_TEXT.guildNone("Alice"));
    expect(target.guildInvite).toBeNull();

    target.prefs = { ...target.prefs, guildInvitesFrom: "friends" };
    out = guildInvite(s.world, leader, "Alice");
    expect(texts(out, leader.id)).toContain(PRIVACY_TEXT.guildFriendsOnly("Alice"));
    expect(target.guildInvite).toBeNull();

    target.buddies = ["Bob"];
    out = guildInvite(s.world, leader, "Alice");
    expect(target.guildInvite).toEqual({ guildId: "g1", inviterId: leader.id });
    expect(sent.length).toBeGreaterThanOrEqual(0);
  });

  test("showNpcChatter hides ambient NPC chatter without hiding Radar/Inxition readouts", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const listener = player("Alice", map, 5, 5);
    const quiet = player("Bob", map, 6, 5);
    quiet.prefs = { ...quiet.prefs, showNpcChatter: false };
    s.join(listener);
    s.join(quiet);
    const room = s.world.rooms.get(map.name);
    if (!room) {
      throw new Error("no room");
    }
    // Ambient RND| chatter skips Bob, reaches Alice.
    const ambient = chatterOut(room, 'Guard says "Move along."', undefined, true);
    expect(ambient.map((o) => o.to)).toEqual(["Alice"]);
    // Non-ambient spell readout reaches both.
    const spell = chatterOut(room, "Someone is nearby.", "Alice", false);
    expect(spell.map((o) => o.to)).toEqual(["Alice", "Bob"]);
  });
});
