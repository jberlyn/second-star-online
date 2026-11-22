/**
 * The player activity log (issue #25): its shared rules, its rows, the ledger check that logs any
 * change no system explained, the progression check, sessions and map changes, and the Control
 * Panel's query with its permission, audit and retention. Each source and sink of items and gold
 * has its own test in activity-sources.test.ts.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  ACTIVITY_GROUPS,
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPES,
  type ActivityRow,
  activityGroup,
  activitySummary,
  emptyBag,
  inGameSchema,
  isActivityType,
  type ServerMsg,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import {
  activityItemTotals,
  activityRows,
  insertActivity,
  pruneActivity,
} from "../src/persistence/activity.ts";
import { recentAudit, recentCheats } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { insertGround, loadGround } from "../src/persistence/ground.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import {
  type ActivityEntry,
  checkHoldings,
  checkProgress,
  holdingsOf,
  logActivity,
  logEditorPlacements,
  resetHoldings,
} from "../src/systems/admin/activity.ts";
import { warp } from "../src/systems/world/tick.ts";
import { NEVER_PUSH, NO_CASINO, player, setup, testMap } from "./helpers/sim.ts";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "r",
  at: "2026-11-22T09:00:00.000Z",
  type: "trade",
  character: "Al",
  other: null,
  otherIsPlayer: false,
  item: null,
  qty: 0,
  gold: 0,
  map: null,
  x: null,
  y: null,
  details: null,
  ...over,
});

describe("the shared rules", () => {
  test("every type is in one group and has a label", () => {
    expect(new Set(ACTIVITY_TYPES).size).toBe(ACTIVITY_TYPES.length);
    for (const t of ACTIVITY_TYPES) {
      expect(isActivityType(t)).toBe(true);
      expect(ACTIVITY_TYPE_LABELS[t]).toBeTruthy();
      expect(ACTIVITY_GROUPS[activityGroup(t)]).toContain(t as never);
    }
    expect(isActivityType("mail")).toBe(false);
  });

  test("a row reads as what moved and with whom", () => {
    expect(activitySummary(row({ item: "Steel Sword", qty: -1, gold: 80, other: "Tracy" }))).toBe(
      "-1 Steel Sword, +80 gold with Tracy",
    );
    expect(
      activitySummary(row({ type: "buy", item: "Apple", qty: 2, gold: -10, other: "Bo" })),
    ).toBe("+2 Apple, -10 gold from Bo");
    expect(activitySummary(row({ type: "pickup", item: "Apple", qty: 1, other: "Bo" }))).toBe(
      "+1 Apple dropped by Bo",
    );
    expect(activitySummary(row({ type: "death", other: "a Slime" }))).toBe("killed by a Slime");
    expect(activitySummary(row({ type: "kill", other: "a Slime" }))).toBe("killed a Slime");
    expect(activitySummary(row({ type: "level", details: { level: 12, from: 11 } }))).toBe(
      "Level 12",
    );
    expect(activitySummary(row({ type: "skill", details: { skill: "Slash", level: 31 } }))).toBe(
      "Slash 31",
    );
    expect(activitySummary(row({ type: "class", details: { from: "Squire", to: "Knight" } }))).toBe(
      "Squire → Knight",
    );
    expect(activitySummary(row({ type: "login", details: { ip: "10.0.0.1" } }))).toBe(
      "from 10.0.0.1",
    );
    expect(
      activitySummary(row({ type: "login", details: { ip: "10.0.0.1", resumed: true } })),
    ).toBe("resumed from 10.0.0.1");
    expect(
      activitySummary(row({ type: "map", map: "x2y1", details: { from: "x1y1", via: "edge" } })),
    ).toBe("x1y1 → x2y1 (edge)");
    expect(activitySummary(row({ type: "loot", item: "Apple", details: { placed: 1 } }))).toBe(
      "Apple, 1 placed",
    );
    expect(activitySummary(row({ type: "pickup", item: "Apple", details: { lost: 1 } }))).toBe(
      "Apple, 1 lost (no room)",
    );
  });
});

describe("the ledger", () => {
  function scene() {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const p = player("Al", map, 5, 5);
    s.join(p);
    p.char.bag = emptyBag();
    p.char.bag[0] = { item: "Apple", qty: 2 };
    p.char.gold = 100;
    resetHoldings(p);
    return { ...s, p };
  }

  test("what a player carries counts bag lines, worn gear and gold, ignoring case and #ids", () => {
    const { p } = scene();
    p.char.bag[1] = { item: "apple", qty: 1 };
    p.char.bag[2] = { item: "Crate#123", qty: 1 };
    p.char.equip.weapon = "Steel Sword";
    expect([...holdingsOf(p.char)]).toEqual([
      ["apple", 3],
      ["crate", 1],
      ["steel sword", 1],
      ["\u0000gold", 100],
    ]);
  });

  test("a logged change moves the ledger, so the check finds nothing", () => {
    const { world, p } = scene();
    logActivity(world, p, "use", { item: "Apple", qty: -1 });
    p.char.bag[0] = { item: "Apple", qty: 1 };
    logActivity(world, p, "bank", { gold: -40 });
    p.char.gold = 60;
    expect(checkHoldings(world, p)).toBe(0);
    expect(world.activity.map((e) => e.type)).toEqual(["use", "bank"]);
  });

  test("a change no system logged is written as unlogged, once, and the ledger follows it", () => {
    const { world, p } = scene();
    p.char.bag[0] = { item: "Apple", qty: 5 };
    p.char.gold = 99;
    p.char.equip.head = "Iron Helm";
    expect(checkHoldings(world, p)).toBe(3);
    expect(world.activity.map((e) => [e.type, e.item, e.qty, e.gold, e.map, e.x, e.y])).toEqual([
      ["unlogged", "Apple", 3, 0, "x1000y992", 5, 5],
      ["unlogged", "Iron Helm", 1, 0, "x1000y992", 5, 5],
      ["unlogged", null, 0, -1, "x1000y992", 5, 5],
    ]);
    expect(checkHoldings(world, p)).toBe(0);
    // An item gone altogether keeps its spelling.
    p.char.bag[0] = null;
    world.activity.length = 0;
    checkHoldings(world, p);
    expect(world.activity.map((e) => [e.item, e.qty])).toEqual([["Apple", -5]]);
  });

  test("the first check only starts the ledger", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const p = player("Al", map, 5, 5);
    s.join(p);
    expect(checkHoldings(s.world, p)).toBe(0);
    expect(s.world.activity).toEqual([]);
  });

  test("levels, classes and skills that went up are logged; the first check only notes them", () => {
    const { world, p } = scene();
    world.activity.length = 0;
    p.activityProgress = undefined;
    checkProgress(world, p);
    expect(world.activity).toEqual([]);
    p.char.vitals.level += 2;
    p.char.classCode = 2;
    p.char.skills[0] = (p.char.skills[0] ?? 0) + 1;
    p.char.skills[1] = (p.char.skills[1] ?? 0) + 3;
    checkProgress(world, p);
    expect(world.activity.map((e) => [e.type, e.details])).toEqual([
      ["level", { level: p.char.vitals.level, from: p.char.vitals.level - 2 }],
      ["class", { from: "Fighter", to: "Mage" }],
      ["skill", { skill: "Slash", level: p.char.skills[0] ?? 0, gained: 1 }],
      ["skill", { skill: "Thrust", level: p.char.skills[1] ?? 0, gained: 3 }],
    ]);
    world.activity.length = 0;
    checkProgress(world, p);
    expect(world.activity).toEqual([]);
  });

  test("a World Editor save logs only the net change in placed items and gold", () => {
    const { world, p } = scene();
    world.activity.length = 0;
    logEditorPlacements(
      world,
      p,
      "x1y1",
      [{ item: "Apple" }, { item: "Rock", qty: 3 }, { item: "50 Gold" }],
      [{ item: "Apple" }, { item: "Rock" }, { item: "5 Blue Crystal" }, { item: "80 Gold" }],
    );
    expect(world.activity.map((e) => [e.type, e.item, e.map, e.x, e.details])).toEqual([
      ["admin", "Rock", "x1y1", null, { via: "worldEditor", placed: -2 }],
      ["admin", "Blue Crystal", "x1y1", null, { via: "worldEditor", placed: 5 }],
      ["admin", null, "x1y1", null, { via: "worldEditor", placedGold: 30 }],
    ]);
    expect(checkHoldings(world, p)).toBe(0);
  });

  test("a warp logs the map change, where it came from and why", () => {
    const here = testMap("x1000y992");
    const there = testMap("x1001y992");
    const s = setup([here, there]);
    const p = player("Al", here, 5, 5);
    s.join(p);
    warp(s.world, p, there, 2, 3, NO_CASINO, "edge");
    expect(s.world.activity).toMatchObject([
      { type: "map", map: "x1001y992", x: 2, y: 3, details: { from: "x1000y992", via: "edge" } },
    ]);
  });
});

describe("the rows", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
  });

  const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
    type: "trade",
    accountId: "acc-al",
    characterId: "char-al",
    character: "Al",
    otherId: null,
    other: null,
    item: null,
    qty: 0,
    gold: 0,
    map: "x1y1",
    x: 1,
    y: 2,
    details: null,
    ...over,
  });

  test("rows come back newest first by character, by name (any case) or by item, with their details", () => {
    insertActivity(
      db,
      [
        entry({
          at: "2026-11-20T00:00:00.000Z",
          item: "Apple",
          qty: -1,
          otherId: "c-bo",
          other: "Bo",
        }),
        entry({ at: "2026-11-21T00:00:00.000Z", type: "login", details: { ip: "10.0.0.1" } }),
        entry({
          at: "2026-11-21T00:00:00.000Z",
          characterId: "char-bo",
          character: "Bo",
          item: "apple",
          qty: 1,
        }),
      ],
      "",
    );
    const q = { types: [], since: null, until: null, before: null, limit: 10 };
    const al = activityRows(db, { ...q, scope: { characterId: "char-al" } });
    expect(al.map((r) => [r.at, r.type, r.other, r.otherIsPlayer, r.details])).toEqual([
      ["2026-11-21T00:00:00.000Z", "login", null, false, { ip: "10.0.0.1" }],
      ["2026-11-20T00:00:00.000Z", "trade", "Bo", true, null],
    ]);
    expect(activityRows(db, { ...q, scope: { name: "AL" } })).toEqual(al);
    expect(activityRows(db, { ...q, scope: { item: "APPLE" } }).map((r) => r.character)).toEqual([
      "Bo",
      "Al",
    ]);
    expect(activityItemTotals(db, "Apple", null, null)).toEqual({
      totals: [{ type: "trade", gained: 1, lost: 1, rows: 2 }],
      capped: false,
    });
  });

  test("an item's totals add up only its newest events up to the cap, and say so", () => {
    insertActivity(
      db,
      [1, 2, 3].map((d) =>
        entry({ at: `2026-11-0${d}T00:00:00.000Z`, item: "Apple", qty: d === 1 ? 5 : -1 }),
      ),
      "",
    );
    expect(activityItemTotals(db, "Apple", null, null, 2)).toEqual({
      totals: [{ type: "trade", gained: 0, lost: 2, rows: 2 }],
      capped: true,
    });
    // Exactly the cap is every row: not capped.
    expect(activityItemTotals(db, "Apple", null, null, 3).capped).toBe(false);
  });

  test("types, times and pages narrow the rows", () => {
    const at = (d: number) => `2026-11-${String(d).padStart(2, "0")}T00:00:00.000Z`;
    insertActivity(
      db,
      [1, 2, 3, 4, 5].map((d) => entry({ at: at(d), type: d % 2 ? "drop" : "pickup" })),
      "",
    );
    const q = { scope: { characterId: "char-al" }, before: null, limit: 10 };
    const days = (rows: ActivityRow[]) => rows.map((r) => r.at.slice(8, 10));
    expect(days(activityRows(db, { ...q, types: ["drop"], since: null, until: null }))).toEqual([
      "05",
      "03",
      "01",
    ]);
    expect(days(activityRows(db, { ...q, types: [], since: at(2), until: at(4) }))).toEqual([
      "03",
      "02",
    ]);
    const first = activityRows(db, { ...q, types: [], since: null, until: null, limit: 2 });
    const last = first.at(-1) as ActivityRow;
    const next = activityRows(db, {
      ...q,
      types: [],
      since: null,
      until: null,
      limit: 2,
      before: { at: last.at, id: last.id },
    });
    expect([days(first), days(next)]).toEqual([
      ["05", "04"],
      ["03", "02"],
    ]);
  });

  test("rows past the retention are pruned; 0 keeps them", () => {
    insertActivity(
      db,
      [entry({ at: "2026-01-01T00:00:00.000Z" }), entry({ at: "2026-11-20T00:00:00.000Z" })],
      "",
    );
    const all = () =>
      activityRows(db, {
        scope: { characterId: "char-al" },
        types: [],
        since: null,
        until: null,
        before: null,
        limit: 10,
      }).length;
    pruneActivity(db, "2026-11-22T00:00:00.000Z", 0);
    expect(all()).toBe(2);
    pruneActivity(db, "2026-11-22T00:00:00.000Z", 30);
    expect(all()).toBe(1);
  });

  test("a ground item keeps who dropped it across a restart", () => {
    const mapId = db.query<{ id: string }, []>("SELECT id FROM maps LIMIT 1").get()?.id ?? "";
    insertGround(
      db,
      {
        id: "g1",
        mapId,
        x: 1,
        y: 1,
        item: "Apple",
        qty: 1,
        kind: "drop",
        expiresAt: null,
        droppedById: "char-al",
        droppedBy: "Al",
      },
      "2026-11-22T00:00:00.000Z",
    );
    expect(loadGround(db, mapId, "2026-11-22T00:00:00.000Z")).toMatchObject([
      { id: "g1", droppedById: "char-al", droppedBy: "Al" },
    ]);
  });
});

describe("the game", () => {
  let db: Db;
  let wall: number;
  const sent: { to: string; msg: ServerMsg }[] = [];
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    wall = Date.parse("2026-11-22T09:00:00.000Z");
    sent.length = 0;
  });

  /** A crash point that throws while armed (a failed write mid-intent). */
  let boom = false;
  function start() {
    boom = false;
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => new Date(wall).toISOString(),
      rng: NEVER_PUSH,
      onFault: () => {},
      crashPoint: (label) => {
        if (boom && label === "persist:mid") {
          throw new Error("disk full");
        }
      },
    });
    const make = async (name: string, role?: "administrator" | "moderator") => {
      await game.create({
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
      const l = await game.login(name, "pw", "10.0.0.1");
      if (!l.ok) {
        throw new Error(l.text);
      }
      if (role) {
        setRole(db, l.accountId, role, new Date(wall).toISOString());
      }
      game.enter(l.characterId, false, "10.0.0.7");
      return l;
    };
    return { game, make };
  }

  const query = (game: Game, id: string, over: Record<string, unknown> = {}) => {
    sent.length = 0;
    game.intent(id, {
      t: "activityQuery",
      seq: 7,
      scope: "character",
      name: "Al",
      types: [],
      since: null,
      until: null,
      before: null,
      limit: 50,
      ...over,
    } as never);
    const reply = sent.find((s) => s.to === id && s.msg.t === "activity")?.msg;
    return reply?.t === "activity" ? reply : null;
  };

  test("a login names the address and a logout follows it, both on the character's timeline", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    wall += 60_000;
    game.leave(al.characterId);
    game.tick();
    const r = query(game, god.characterId, { types: ["login", "logout"] });
    expect(r?.rows.map((x) => [x.type, x.at, x.details])).toEqual([
      ["logout", "2026-11-22T09:01:00.000Z", { ip: "10.0.0.7" }],
      ["login", "2026-11-22T09:00:00.000Z", { ip: "10.0.0.7" }],
    ]);
    expect(r?.seq).toBe(7);
    expect(r?.more).toBe(false);
  });

  test("a change no event explained is logged as unlogged at the next tick", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("not online");
    }
    p.char.gold += 500;
    game.tick();
    const r = query(game, god.characterId, { types: ["unlogged"] });
    expect(r?.rows.map((x) => [x.type, x.gold])).toEqual([["unlogged", 500]]);
  });

  test("an intent whose writes roll back logs nothing for its player, who reloads from the database", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const rows = () =>
      query(game, god.characterId, { types: ["drop", "unlogged"] })?.rows.map((r) => [
        r.type,
        r.item,
        r.qty,
      ]);
    const ready = () => {
      const p = game.world.players.get(al.characterId);
      if (p) {
        p.loading = 0;
        p.itemPause = 0;
      }
    };
    // A new character starts with Apples in slot 1. Dropping one fails to save.
    ready();
    boom = true;
    game.intent(al.characterId, { t: "drop", slot: 1 });
    boom = false;
    expect(game.world.players.has(al.characterId)).toBe(false);
    game.tick();
    expect(rows()).toEqual([]);
    // Dropped again once the writes work: logged once.
    game.enter(al.characterId, false, "10.0.0.7");
    ready();
    game.intent(al.characterId, { t: "drop", slot: 1 });
    game.tick();
    game.tick();
    expect(rows()).toEqual([["drop", "Apple", -1]]);
  });

  test("an unknown event type refuses the query; a deleted character with a date filter is not an error", async () => {
    expect(
      inGameSchema.safeParse({
        t: "activityQuery",
        seq: 1,
        scope: "character",
        name: "Al",
        types: ["bogus"],
        since: null,
        until: null,
        before: null,
        limit: 10,
      }).success,
    ).toBe(false);
    const { game, make } = start();
    const god = await make("God", "administrator");
    const r = query(game, god.characterId, {
      name: "  Ghost ",
      since: "2026-11-20T00:00:00.000Z",
    });
    expect(r?.error).toBeUndefined();
    expect(r?.rows).toEqual([]);
  });

  test("buffered rows written by an intent that rolls back are kept and written later", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    game.leave(al.characterId);
    // `/save` writes the buffers inside the intent, then a later write fails and it all rolls back.
    boom = true;
    game.intent(god.characterId, { t: "chat", text: "/save" });
    boom = false;
    expect(game.world.players.has(god.characterId)).toBe(false);
    game.enter(god.characterId, false, "10.0.0.7");
    game.tick();
    const r = query(game, god.characterId, { types: ["logout"] });
    expect(r?.rows.map((x) => x.character)).toEqual(["Al"]);
  });

  test("at shutdown the logouts after the last save are written before the database closes", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    game.saveAll();
    // Closing the sockets logs everyone out after the save.
    game.leave(al.characterId);
    game.flushLogs();
    const logouts = activityRows(db, {
      scope: { name: "Al" },
      types: ["logout"],
      since: null,
      until: null,
      before: null,
      limit: 5,
    });
    expect(logouts).toHaveLength(1);
    expect(game.world.activity.filter((e) => e.characterId !== god.characterId)).toEqual([]);
  });

  test("a new character's starting items are logged as where they came from", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    await make("Al");
    game.tick();
    const r = query(game, god.characterId, { types: ["reward"] });
    expect(r?.rows.map((x) => [x.item, x.qty, x.details])).toEqual(
      expect.arrayContaining([["Apple", 2, { start: true }]]),
    );
  });

  test("reading the log needs its permission: a player or moderator is cheat-logged and gets nothing", async () => {
    const { game, make } = start();
    const mod = await make("Mod", "moderator");
    const al = await make("Al");
    expect(query(game, al.characterId)).toBeNull();
    expect(query(game, mod.characterId)).toBeNull();
    expect(
      recentCheats(db, 5)
        .map((c) => [c.name, c.reason])
        .sort(),
    ).toEqual([
      ["Al", "Attempted Admin Access"],
      ["Mod", "Attempted Admin Access"],
    ]);
  });

  test("every read is audited, a further page too", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    await make("Al");
    query(game, god.characterId, { name: "al" });
    query(game, god.characterId, { scope: "item", name: "Apple", types: ["trade"] });
    query(game, god.characterId, { before: { at: "2026-11-22T09:00:00.000Z", id: "z" } });
    expect(
      recentAudit(db, 10)
        .filter((a) => a.command === "activityLog")
        .map((a) => [a.target, a.after]),
    ).toEqual([
      ["Al", '{"scope":"character","types":[],"since":null,"until":null}'],
      ["Apple", '{"scope":"item","types":["trade"],"since":null,"until":null}'],
      [
        "Al",
        '{"scope":"character","types":[],"since":null,"until":null,"before":"2026-11-22T09:00:00.000Z"}',
      ],
    ]);
  });

  test("an unknown character is an error; a deleted one is still read by name", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    expect(query(game, god.characterId, { name: "Nobody" })?.error).toBe(
      "There is no character called Nobody.",
    );
    insertActivity(
      db,
      [
        {
          at: "2026-11-01T00:00:00.000Z",
          type: "drop",
          accountId: "gone",
          characterId: "gone",
          character: "Ghost",
          otherId: null,
          other: null,
          item: "Apple",
          qty: -1,
          gold: 0,
          map: null,
          x: null,
          y: null,
          details: null,
        },
      ],
      "",
    );
    const r = query(game, god.characterId, { name: "ghost" });
    expect(r?.error).toBeUndefined();
    expect(r?.rows.map((x) => [x.character, x.item])).toEqual([["Ghost", "Apple"]]);
  });

  test("a page says when older rows match, and an item's first page carries its totals", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    for (let i = 0; i < 3; i++) {
      wall += 1000;
      game.leave(al.characterId);
      game.enter(al.characterId, false, "10.0.0.7");
    }
    game.tick();
    const r = query(game, god.characterId, { types: ["login"], limit: 2 });
    expect(r?.rows).toHaveLength(2);
    expect(r?.more).toBe(true);
    const flow = query(game, god.characterId, { scope: "item", name: "Steel Sword" });
    expect(flow?.totals).toEqual([]);
  });

  test("the activity log's retention setting prunes old rows at start", async () => {
    insertActivity(
      db,
      [
        {
          at: "2026-01-01T00:00:00.000Z",
          type: "drop",
          accountId: "a",
          characterId: "c",
          character: "Al",
          otherId: null,
          other: null,
          item: "Apple",
          qty: -1,
          gold: 0,
          map: null,
          x: null,
          y: null,
          details: null,
        },
      ],
      "",
    );
    saveSettingOverride(db, "activityLogRetention", 30 * 86_400, "");
    start();
    const left = activityRows(db, {
      scope: { item: "Apple" },
      types: [],
      since: null,
      until: null,
      before: null,
      limit: 5,
    });
    expect(left).toEqual([]);
  });
});
