/**
 * The player hub's character editor (issue #26): edits to an online character land on the live
 * character and reach their client; edits to an offline one are written to the database; every
 * value is checked against the game's limits; the edit log keeps the reason and each field's
 * before and after values; undo refuses when something it set has changed since.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  type CharacterHub,
  changeText,
  deriveEdit,
  EDIT_TEXT,
  type EditableCharacter,
  editableOf,
  editErrors,
  inGameSchema,
  type ServerMsg,
  staleCheckFields,
  undoConflicts,
  wearBreaks,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit, recentCheats } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadStoredCharacter } from "../src/persistence/hub.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

const base = (): EditableCharacter => ({
  classCode: 1,
  level: 5,
  exp: 10,
  expNeeded: 410,
  hp: 20,
  hpMax: 24,
  sp: 20,
  spMax: 24,
  str: 10,
  sta: 10,
  dex: 10,
  int: 10,
  wis: 10,
  skills: [1, 1, 1],
  hunger: 30000,
  faction: 0,
  factionCount: 0,
  wanted: false,
  respawn: { map: "x1000y992", x: 5, y: 5 },
  gold: 100,
  bank: null,
  bag: Array.from({ length: 15 }, () => null),
  equip: {
    weapon: "NOTHING",
    offHand: "NOTHING",
    head: "NOTHING",
    body: "NOTHING",
    feet: "NOTHING",
    ring: "NOTHING",
  },
  vault: [],
  spellbook: [],
  position: { map: "x1000y992", x: 5, y: 5 },
  sex: 1,
  head: 1,
});

describe("the editor's rules", () => {
  test("a level change sets the experience needed and moves HP and SP max with it", () => {
    const a = deriveEdit(base(), { level: 7 });
    expect([a.expNeeded, a.hpMax, a.spMax]).toEqual([414, 26, 26]);
    const down = deriveEdit({ ...base(), hp: 24, exp: 300 }, { level: 2 });
    // Down three levels: HP and experience come within the new limits unless they were typed.
    expect([down.expNeeded, down.hpMax, down.hp, down.exp]).toEqual([400, 21, 21, 300]);
    expect(deriveEdit(base(), { level: 1 }).expNeeded).toBe(30);
    // Derived values sent by a client are ignored.
    expect(deriveEdit(base(), { hpMax: 999 } as never).hpMax).toBe(24);
  });

  test("values outside the game's limits are refused", () => {
    const b = base();
    const err = (c: Partial<EditableCharacter>) => editErrors(b, deriveEdit(b, c));
    expect(err({ str: 21 })).toEqual(["Strength: a whole number from 1 to 20."]);
    expect(err({ level: 0 })[0]).toContain("Level");
    expect(err({ exp: 410 })[0]).toContain("Experience");
    expect(err({ hp: 25 })).toEqual(["HP: a whole number from 1 to 24."]);
    expect(err({ skills: [1, 101, 1] })[0]).toContain("from 1 to 100");
    expect(err({ skills: [1, 1] })).toEqual(["Skills: there are 3."]);
    expect(err({ gold: -1 })[0]).toContain("Gold");
    expect(err({ bank: 5 })).toEqual(["Bank: they have no bank account yet."]);
    expect(err({ classCode: 99 })).toEqual(["Class: there is no such class."]);
    expect(err({ head: 2 })[0]).toContain("male head");
    expect(err({ position: { map: "x1y1", x: 18, y: 1 } })[0]).toContain("within 1-17");
    const bag = [...b.bag];
    bag[0] = { item: "Dragon Egg Omelette", qty: 1 };
    expect(err({ bag })).toEqual(["Bag line 1: there is no item called Dragon Egg Omelette."]);
    bag[0] = { item: "5 Gold", qty: 1 };
    expect(err({ bag })[0]).toContain("gold is not a bag item");
    bag[0] = { item: "Crate", qty: 2 };
    expect(err({ bag })[0]).toContain("never stacks");
    bag[0] = { item: "apple", qty: 3 };
    expect(err({ bag })).toEqual([]);
    expect(err({ spellbook: ["Minor Heal", "Minor Heal"] })).toEqual([
      "Spellbook: Minor Heal is listed twice.",
    ]);
    expect(err({ spellbook: ["Fireball of Doom"] })[0]).toContain("no spell");
    expect(err({ vault: Array(16).fill("Apple") })[0]).toContain("at most 15");
  });

  test("an old item already in the bag does not block an unrelated edit", () => {
    const b = base();
    b.bag[0] = { item: "Retired Thing", qty: 1 };
    expect(editErrors(b, deriveEdit(b, { gold: 5 }))).toEqual([]);
  });

  test("worn gear must follow the wear rules; gear already worn stays legal", () => {
    const b = base();
    const wear = (equip: Partial<EditableCharacter["equip"]>, str = 10) => {
      const a = deriveEdit(b, { equip: { ...b.equip, ...equip } });
      return wearBreaks(b, a, str);
    };
    expect(wear({ weapon: "Knife" })).toEqual([]);
    expect(wear({ head: "Knife" })[0]).toContain("not the head");
    expect(wear({ offHand: "Pharaoh Shield" })[0]).toContain("not strong enough");
    expect(wear({ offHand: "Pharaoh Shield" }, 22)).toEqual([]);
    expect(wear({ weapon: "War Hammer", offHand: "Small Shield" }).length).toBeGreaterThan(0);
    expect(wear({ head: "Murder Helm" })[0]).toContain("vile");
    // Already worn: an edit that leaves it alone does not re-check it.
    const worn = { ...b, equip: { ...b.equip, offHand: "Pharaoh Shield" } };
    expect(wearBreaks(worn, deriveEdit(worn, { gold: 1 }), 10)).toEqual([]);
  });

  test("changing the wanted flag leaves worn gear alone, except murder gear once it clears", () => {
    const worn = { ...base(), equip: { ...base().equip, offHand: "Pharaoh Shield" } };
    expect(wearBreaks(worn, deriveEdit(worn, { wanted: true }), 10)).toEqual([]);
    const killer = { ...base(), wanted: true, equip: { ...base().equip, head: "Murder Helm" } };
    expect(wearBreaks(killer, deriveEdit(killer, { wanted: false }), 10)[0]).toContain("vile");
  });

  test("gold, containers in the vault and worn #id items are refused; held names may move", () => {
    const b = base();
    const err = (c: Partial<EditableCharacter>) => editErrors(b, deriveEdit(b, c));
    const bag = [...b.bag];
    bag[0] = { item: "Gold", qty: 10 };
    expect(err({ bag })[0]).toContain("gold is not a bag item");
    expect(err({ vault: ["Gold"] })[0]).toContain("gold is not a vault item");
    expect(err({ vault: ["Crate"] })[0]).toContain("container");
    // A painting the character holds moves between lines, but never stacks into a copy.
    const art = { ...b, bag: [{ item: "Painting#12", qty: 1 }, ...b.bag.slice(1)] };
    const moved = [null, { item: "Painting#12", qty: 1 }, ...art.bag.slice(2)];
    expect(editErrors(art, deriveEdit(art, { bag: moved }))).toEqual([]);
    const stacked = [{ item: "Painting#12", qty: 2 }, ...art.bag.slice(1)];
    expect(editErrors(art, deriveEdit(art, { bag: stacked })).length).toBeGreaterThan(0);
  });

  test("undo conflicts name the fields that moved since", () => {
    const b = base();
    const changes = [
      { field: "gold" as const, before: 100, after: 500 },
      { field: "level" as const, before: 5, after: 6 },
    ];
    expect(undoConflicts({ ...b, gold: 500, level: 6 }, changes)).toEqual([]);
    expect(undoConflicts({ ...b, gold: 450, level: 6 }, changes)).toEqual(["gold"]);
  });

  test("the intents are strict: no derived field, no stray field", () => {
    const ok = {
      t: "characterEdit",
      seq: 1,
      name: "Al",
      set: { gold: 5 },
      seen: { gold: 1 },
      override: false,
      reason: "x",
    };
    expect(inGameSchema.safeParse(ok).success).toBe(true);
    expect(inGameSchema.safeParse({ ...ok, set: { hpMax: 5 } }).success).toBe(false);
    expect(inGameSchema.safeParse({ ...ok, set: { password: "x" } }).success).toBe(false);
    expect(
      inGameSchema.safeParse({ t: "characterUndo", seq: 1, name: "Al", id: "x", reason: "y" })
        .success,
    ).toBe(true);
  });
});

describe("editing a character from the hub", () => {
  let db: Db;
  let wall: number;
  const sent: { to: string; msg: ServerMsg }[] = [];

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    wall = Date.parse("2026-11-22T09:00:00.000Z");
    sent.length = 0;
    db.run(
      `INSERT INTO roles (id, name, rank, permissions, created_at, updated_at)
       VALUES ('viewer', 'Viewer', 1, '["characterView"]', ?, ?)`,
      [new Date(wall).toISOString(), new Date(wall).toISOString()],
    );
  });

  function start() {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => new Date(wall).toISOString(),
      rng: NEVER_PUSH,
    });
    let ips = 0;
    const make = async (name: string, role?: string, online = true) => {
      ips += 1;
      await game.create(
        {
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
        },
        `10.0.1.${ips}`,
      );
      const l = await game.login(name, "pw", "10.0.0.1");
      if (!l.ok) {
        throw new Error(l.text);
      }
      if (role) {
        setRole(db, l.accountId, role, new Date(wall).toISOString());
      }
      if (online) {
        game.enter(l.characterId, false, "10.0.0.7");
      }
      return l;
    };
    return { game, make };
  }

  const reply = <T extends ServerMsg["t"]>(id: string, t: T) =>
    sent.findLast((s) => s.to === id && s.msg.t === t)?.msg as
      | Extract<ServerMsg, { t: T }>
      | undefined;

  const hubOf = (game: Game, id: string, name = "Al"): CharacterHub => {
    game.intent(id, { t: "characterOpen", seq: 3, name });
    const h = reply(id, "characterHub")?.hub;
    if (!h) {
      throw new Error("no hub");
    }
    return h;
  };

  /** Edits `name` as the hub would: `set` with what the hub shows now as `seen`. */
  const edit = (
    game: Game,
    id: string,
    set: Partial<EditableCharacter>,
    over: {
      name?: string;
      reason?: string;
      override?: boolean;
      seen?: Partial<EditableCharacter>;
    } = {},
  ) => {
    const name = over.name ?? "Al";
    const now = editableOf(hubOf(game, id, name).sheet);
    const seen = Object.fromEntries(staleCheckFields(set).map((k) => [k, now[k]]));
    sent.length = 0;
    game.intent(id, {
      t: "characterEdit",
      seq: 7,
      name,
      set,
      seen: over.seen ?? seen,
      override: over.override ?? false,
      reason: over.reason ?? "fixing an exploit",
    } as never);
    return reply(id, "characterResult");
  };

  const undo = (game: Game, id: string, editId: string, name = "Al") => {
    sent.length = 0;
    game.intent(id, { t: "characterUndo", seq: 8, name, id: editId, reason: "mistake" });
    return reply(id, "characterResult");
  };

  const activity = () =>
    db
      .query<
        {
          type: string;
          item: string | null;
          qty: number;
          gold: number;
          other: string | null;
          details: string | null;
        },
        []
      >(
        "SELECT type, item, qty, gold, other, details FROM activity_log WHERE character = 'Al' AND type IN ('admin', 'unlogged') ORDER BY created_at, id",
      )
      .all();

  test("an online edit lands on the live character, reaches their client and is saved at once", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const r = edit(game, god.characterId, { level: 9, gold: 5000, str: 15 });
    expect(r).toEqual({ t: "characterResult", seq: 7, ok: true, text: EDIT_TEXT.saved("Al", 6) });
    const p = game.world.players.get(al.characterId);
    expect(p?.char.vitals).toMatchObject({ level: 9, expNeeded: 418, hpMax: 28, spMax: 28 });
    expect(p?.char.gold).toBe(5000);
    expect(p?.char.stats.str).toBe(15);
    // Their client hears at once.
    expect(sent.some((s) => s.to === al.characterId && s.msg.t === "vitals")).toBe(true);
    expect(
      sent.some((s) => s.to === al.characterId && s.msg.t === "inv" && s.msg.inv.gold === 5000),
    ).toBe(true);
    // Written now, so a crash or the next save cannot lose it.
    const saved = loadStoredCharacter(db, al.characterId);
    expect(saved?.record.vitals.level).toBe(9);
    expect(saved?.record.stats.str).toBe(15);
    expect(saved?.inventory.gold).toBe(5000);
    // The tick's ledger check finds nothing unlogged: the gold is an admin event.
    game.tick();
    game.tick();
    const a = activity();
    expect(a.filter((e) => e.type === "unlogged")).toEqual([]);
    expect(a.map((e) => [e.type, e.gold, e.other])).toEqual([
      ["admin", 5000, "God"],
      ["admin", 0, "God"],
    ]);
    expect(JSON.parse(a[1]?.details ?? "{}").fields).toBe(
      "Level, Experience needed, HP max, SP max, Strength",
    );
    // The log row: who, why, and every field before and after.
    const hub = hubOf(game, god.characterId);
    expect(hub.edits).toHaveLength(1);
    expect(hub.edits[0]).toMatchObject({
      actorName: "God",
      reason: "fixing an exploit",
      override: false,
    });
    expect(hub.edits[0]?.changes.find((c) => c.field === "gold")).toEqual({
      field: "gold",
      before: 0,
      after: 5000,
    });
    expect(recentAudit(db, 5).some((x) => x.command === "characterEdit" && x.target === "Al")).toBe(
      true,
    );
  });

  test("an offline edit is written to the database and is there at their next login", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al", undefined, false);
    const bag = editableOf(hubOf(game, god.characterId).sheet).bag;
    bag[4] = { item: "Broad Sword", qty: 2 };
    const r = edit(game, god.characterId, {
      bag,
      skills: editableOf(hubOf(game, god.characterId).sheet).skills.map((v, i) =>
        i === 0 ? 40 : v,
      ),
      spellbook: ["Minor Heal"],
      hunger: 1234,
      sex: 2,
      head: 7,
      classCode: 5,
      position: { map: "x1000y992", x: 3, y: 4 },
    });
    expect(r?.text).toBe(EDIT_TEXT.saved("Al", 8));
    game.enter(al.characterId, false, "10.0.0.7");
    const p = game.world.players.get(al.characterId);
    expect(p?.char.bag[4]).toEqual({ item: "Broad Sword", qty: 2 });
    expect(p?.char.skills[0]).toBe(40);
    expect(p?.spell.book).toEqual(["Minor Heal"]);
    expect(p?.char.hunger).toBe(1234);
    expect([p?.char.sex, p?.head, p?.char.classCode]).toEqual([2, 7, 5]);
    expect([p?.x, p?.y]).toEqual([3, 4]);
    // Logged for the offline character too, so their next ledger starts right.
    game.tick();
    expect(activity().map((e) => [e.type, e.item, e.qty])).toEqual([
      ["admin", "Broad Sword", 2],
      ["admin", null, 0],
    ]);
  });

  test("a bare Crate gets its own storage, as one bought does", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const bag = editableOf(hubOf(game, god.characterId).sheet).bag;
    bag[6] = { item: "Crate", qty: 1 };
    expect(edit(game, god.characterId, { bag })?.ok).toBe(true);
    expect(game.world.players.get(al.characterId)?.char.bag[6]?.item).toMatch(/^Crate#\d+$/);
  });

  test("a value out of the game's limits, a stale hub and no reason are refused", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    expect(edit(game, god.characterId, { str: 50 })?.text).toBe(
      "Strength: a whole number from 1 to 20.",
    );
    expect(edit(game, god.characterId, { gold: 5 }, { reason: "   " })?.text).toBe(
      EDIT_TEXT.needReason,
    );
    // The player picked up gold after the hub was read: the edit would throw it away.
    expect(edit(game, god.characterId, { gold: 5 }, { seen: { gold: 1 } })?.text).toBe(
      EDIT_TEXT.stale(["Gold"]),
    );
    expect(edit(game, god.characterId, { gold: 0 })?.text).toBe(EDIT_TEXT.nothing);
    expect(game.world.players.get(al.characterId)?.char.gold).toBe(0);
    expect(hubOf(game, god.characterId).edits).toEqual([]);
  });

  test("gear that breaks the wear rules needs the override, which is logged", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const equip = {
      ...editableOf(hubOf(game, god.characterId).sheet).equip,
      offHand: "Pharaoh Shield",
    };
    const refused = edit(game, god.characterId, { equip });
    expect(refused?.ok).toBe(false);
    expect(refused?.text).toContain(EDIT_TEXT.wear);
    expect(edit(game, god.characterId, { equip }, { override: true })?.ok).toBe(true);
    const p = game.world.players.get(al.characterId);
    expect(p?.char.equip.offHand).toBe("Pharaoh Shield");
    expect(hubOf(game, god.characterId).edits[0]?.override).toBe(true);
    // Others on the map see the new look.
    expect(p?.lookDirty === false).toBe(true);
  });

  test("gold and items wait while the character trades or sits at a table; a move waits while they edit", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("offline");
    }
    p.trade = "t1";
    expect(edit(game, god.characterId, { gold: 5 })?.text).toBe(EDIT_TEXT.busy("Al"));
    p.trade = null;
    p.editing = "controlPanel";
    expect(edit(game, god.characterId, { position: { map: "x1000y992", x: 2, y: 2 } })?.text).toBe(
      EDIT_TEXT.editing("Al"),
    );
    expect(edit(game, god.characterId, { gold: 5 })?.ok).toBe(true);
  });

  test("a move needs a map that exists and respects the jail", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    await make("Al");
    expect(edit(game, god.characterId, { position: { map: "nowhere", x: 2, y: 2 } })?.text).toBe(
      EDIT_TEXT.noMap("nowhere"),
    );
    expect(edit(game, god.characterId, { position: { map: "x0y0", x: 2, y: 2 } })?.text).toBe(
      EDIT_TEXT.jailMap,
    );
    sent.length = 0;
    game.intent(god.characterId, {
      t: "characterModerate",
      seq: 5,
      name: "Al",
      action: "jail",
      duration: "1h",
      reason: "x",
    });
    expect(edit(game, god.characterId, { position: { map: "x1000y992", x: 2, y: 2 } })?.text).toBe(
      EDIT_TEXT.jailed("Al"),
    );
  });

  test("undo puts the old values back, and refuses once something it set has moved", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    expect(edit(game, god.characterId, { gold: 900, level: 3 })?.ok).toBe(true);
    const first = hubOf(game, god.characterId).edits[0];
    if (!first) {
      throw new Error("not logged");
    }
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("offline");
    }
    // The player spent some of it since: undo would destroy that.
    p.char.gold = 850;
    p.invDirty = true;
    game.tick();
    expect(undo(game, god.characterId, first.id)?.text).toBe(EDIT_TEXT.undoConflict(["Gold"]));
    p.char.gold = 900;
    p.invDirty = true;
    game.tick();
    expect(undo(game, god.characterId, first.id)).toMatchObject({
      ok: true,
      text: EDIT_TEXT.undone("Al"),
    });
    expect([p.char.gold, p.char.vitals.level, p.char.vitals.expNeeded]).toEqual([0, 1, 30]);
    const edits = hubOf(game, god.characterId).edits;
    expect(edits.map((e) => [e.undoOf, e.undoneBy])).toEqual([
      [first.id, null],
      [null, edits[0]?.id ?? ""],
    ]);
    expect(undo(game, god.characterId, first.id)?.text).toBe(EDIT_TEXT.alreadyUndone);
    // An edit to one character cannot be undone through another's name.
    await make("Bo");
    expect(undo(game, god.characterId, edits[0]?.id ?? "", "Bo")?.text).toBe(EDIT_TEXT.noEdit);
  });

  test("undo works offline too", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al", undefined, false);
    expect(edit(game, god.characterId, { wanted: true, faction: 2 })?.ok).toBe(true);
    const id = hubOf(game, god.characterId).edits[0]?.id ?? "";
    expect(undo(game, god.characterId, id)?.ok).toBe(true);
    const s = loadStoredCharacter(db, al.characterId);
    expect([s?.record.wanted, s?.record.faction.id]).toEqual([false, 0]);
  });

  test("an old edit that changed Agility or Speed still reads and undoes the rest", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    expect(edit(game, god.characterId, { gold: 900 })?.ok).toBe(true);
    const id = hubOf(game, god.characterId).edits[0]?.id ?? "";
    // Logged before the stats were dropped.
    const row = db.query<{ changes: string }, [string]>(
      "SELECT changes FROM character_edits WHERE id = ?",
    );
    const changes = JSON.parse(row.get(id)?.changes ?? "[]");
    changes.push({ field: "spd", before: 1, after: 5 }, { field: "agi", before: 1, after: 3 });
    db.run("UPDATE character_edits SET changes = ? WHERE id = ?", [JSON.stringify(changes), id]);
    expect(changeText({ field: "spd", before: 1, after: 5 } as never)).toBe("Speed: 1 → 5");
    expect(undo(game, god.characterId, id)?.ok).toBe(true);
    expect(game.world.players.get(al.characterId)?.char.gold).toBe(0);
  });

  test("online class, sex and head edits are saved, and a new head redraws without a warp", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    const at = [p?.map.name, p?.x, p?.y];
    expect(edit(game, god.characterId, { classCode: 5, sex: 2, head: 7 })?.ok).toBe(true);
    // No warp: they stay where they stood, and the map hears the new head in a look event.
    expect([p?.map.name, p?.x, p?.y]).toEqual(at);
    expect(sent.some((s) => s.to === al.characterId && s.msg.t === "snapshot")).toBe(false);
    expect(
      sent.some(
        (s) =>
          s.to === al.characterId &&
          s.msg.t === "delta" &&
          s.msg.events.some((ev) => ev.e === "look" && ev.head === 7),
      ),
    ).toBe(true);
    game.leave(al.characterId);
    const saved = loadStoredCharacter(db, al.characterId)?.record;
    expect([saved?.classCode, saved?.sex, saved?.head]).toEqual([5, 2, 7]);
  });

  test("a seat kept for a dropped blackjack player holds their gold and place", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al", undefined, false);
    // Mid-hand, the seat waits out the grace by id while they are offline.
    game.world.casinoTables.set("t", {
      seats: [{ id: al.characterId, name: "Al", awayIn: 50 }, null],
    } as never);
    expect(edit(game, god.characterId, { gold: 5 })?.text).toBe(EDIT_TEXT.busy("Al"));
    expect(edit(game, god.characterId, { position: { map: "x1000y992", x: 2, y: 2 } })?.text).toBe(
      EDIT_TEXT.busy("Al"),
    );
    expect(edit(game, god.characterId, { hunger: 5 })?.ok).toBe(true);
  });

  test("a level change is refused when the experience, HP or SP it recalculates moved since", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    await make("Al");
    expect(
      edit(game, god.characterId, { level: 4 }, { seen: { level: 1, exp: 9, hp: 20, sp: 20 } })
        ?.text,
    ).toBe(EDIT_TEXT.stale(["Experience"]));
    // A client that leaves them out is refused too.
    expect(edit(game, god.characterId, { level: 4 }, { seen: { level: 1 } })?.text).toBe(
      EDIT_TEXT.badField("exp"),
    );
  });

  test("an item with its own storage can't be typed in or copied", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const bag = editableOf(hubOf(game, god.characterId).sheet).bag;
    bag[5] = { item: "Crate#4242", qty: 1 };
    expect(edit(game, god.characterId, { bag })?.text).toContain("add it by its bare name");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("offline");
    }
    p.char.bag[5] = { item: "Crate#77", qty: 1 };
    p.invDirty = true;
    game.tick();
    const copy = editableOf(hubOf(game, god.characterId).sheet).bag;
    copy[6] = { item: "Crate#77", qty: 1 };
    expect(edit(game, god.characterId, { bag: copy })?.text).toContain("can't be copied");
    // Moving it to another line is fine.
    const moved = editableOf(hubOf(game, god.characterId).sheet).bag;
    moved[6] = moved[5] ?? null;
    moved[5] = null;
    expect(edit(game, god.characterId, { bag: moved })?.ok).toBe(true);
  });

  test("undo refuses a state that no longer fits, and never puts back overridden gear silently", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("offline");
    }
    expect(edit(game, god.characterId, { level: 5 })?.ok).toBe(true);
    const raise = hubOf(game, god.characterId).edits[0]?.id ?? "";
    // They heal above the old maximum: putting the old HP max back would leave HP over it.
    p.char.vitals.hp = p.char.vitals.hpMax;
    game.tick();
    expect(undo(game, god.characterId, raise)?.text).toContain(EDIT_TEXT.undoInvalid);
    // Gear saved with the override, taken off by an undo, then the undo undone.
    const equip = {
      ...editableOf(hubOf(game, god.characterId).sheet).equip,
      offHand: "Pharaoh Shield",
    };
    expect(edit(game, god.characterId, { equip }, { override: true })?.ok).toBe(true);
    const worn = hubOf(game, god.characterId).edits[0]?.id ?? "";
    expect(undo(game, god.characterId, worn)?.ok).toBe(true);
    const off = hubOf(game, god.characterId).edits[0]?.id ?? "";
    expect(undo(game, god.characterId, off)?.text).toContain(EDIT_TEXT.undoWear);
  });

  test("an open vault is redrawn, and bank and vault changes are logged with their amounts", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("offline");
    }
    p.char.bank = 10;
    p.vaultOpen = true;
    expect(edit(game, god.characterId, { bank: 510, vault: ["Apple", "Apple"] })?.ok).toBe(true);
    expect(
      sent.some((s) => s.to === al.characterId && s.msg.t === "vault" && s.msg.items.length === 2),
    ).toBe(true);
    game.tick();
    const details = activity()
      .filter((e) => e.type === "admin")
      .map((e) => [e.item, JSON.parse(e.details ?? "{}")]);
    expect(details).toContainEqual([null, expect.objectContaining({ bank: 500 })]);
    expect(details).toContainEqual(["Apple", expect.objectContaining({ vault: 2 })]);
  });

  test("a map name in another case finds the live map, not a second copy", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    expect(edit(game, god.characterId, { position: { map: "X1000Y992", x: 3, y: 3 } })?.ok).toBe(
      true,
    );
    const p = game.world.players.get(al.characterId);
    const live = game.world.rooms.get("x1000y992");
    expect(p?.map.name).toBe("x1000y992");
    expect(live?.map).toBe(p?.map);
    // The log names the map as the game does.
    expect(hubOf(game, god.characterId).edits[0]?.changes[0]?.after).toEqual({
      map: "x1000y992",
      x: 3,
      y: 3,
    });
  });

  test("a crate opened from the bag closes when the edit takes it away", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("offline");
    }
    p.char.bag[5] = { item: "Crate#77", qty: 1 };
    p.invDirty = true;
    game.tick();
    p.container = { name: "Crate#77", shown: [], carried: true } as never;
    p.keyLock = true;
    const bag = editableOf(hubOf(game, god.characterId).sheet).bag;
    bag[5] = null;
    expect(edit(game, god.characterId, { bag })?.ok).toBe(true);
    expect(p.container).toBeNull();
    expect(
      sent.some((x) => x.to === al.characterId && x.msg.t === "vault" && x.msg.closed === true),
    ).toBe(true);
  });

  test("viewing is not editing: characterView alone gets no edit and is written to the cheat log", async () => {
    const { game, make } = start();
    const viewer = await make("Vic", "viewer");
    const al = await make("Al");
    sent.length = 0;
    game.intent(viewer.characterId, {
      t: "characterEdit",
      seq: 7,
      name: "Al",
      set: { gold: 5 },
      seen: { gold: 0 },
      override: false,
      reason: "x",
    });
    expect(sent).toEqual([]);
    expect(game.world.players.get(al.characterId)?.char.gold).toBe(0);
    expect(recentCheats(db, 5).map((c) => c.reason)).toContain("Attempted Admin Access");
    // The log itself is part of the hub, for characterView.
    expect(hubOf(game, viewer.characterId).edits).toEqual([]);
  });
});
