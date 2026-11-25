/**
 * Item reconciliation (issue #35): a run saves the world, counts every holder in the database and
 * compares the count with the last run's plus what the activity log made and ended since. The
 * world events that make or destroy items with no player write their rows; a crash's held
 * blackjack stake is refunded with a row on restart; the Activity Log page's intents are gated by
 * the `activityLog` permission.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ReconcileRunView, ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { insertGround } from "../src/persistence/ground.ts";
import { migrate } from "../src/persistence/migrations.ts";
import {
  activityFlows,
  countHoldings,
  recentRuns,
  runCounts,
  saveCasinoHolds,
} from "../src/persistence/reconcile.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import { logWorld } from "../src/systems/admin/activity.ts";
import { bjSit } from "../src/systems/casino/blackjack.ts";
import { depositContainer, saveClockStep } from "../src/systems/economy/containers.ts";
import { demolish } from "../src/systems/housing/houses.ts";
import { decayLoot } from "../src/systems/inventory/items.ts";
import { addPlayer, createWorld, type GroundItem, type Room } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

describe("the game", () => {
  let db: Db;
  let wall: number;
  const sent: { to: string; msg: ServerMsg }[] = [];
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    wall = Date.parse("2026-11-22T09:00:00.000Z");
    sent.length = 0;
    boom = false;
    faults = 0;
  });

  /** Armed: the next write mid-persist throws (a failed write), and faults are only counted. */
  let boom = false;
  let faults = 0;
  function start(opts: { nightly?: boolean } = {}) {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => new Date(wall).toISOString(),
      rng: rngByN(),
      onFault: (where, err) => {
        if (boom) {
          faults += 1;
          return;
        }
        throw new Error(`${where}: ${String(err)}`);
      },
      crashPoint: (label) => {
        if (boom && label === "persist:mid") {
          throw new Error("disk full");
        }
      },
      ...(opts.nightly ? { nightlyReconcile: true } : {}),
    });
    const make = async (name: string, role?: "administrator") => {
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
      const p = game.world.players.get(l.characterId);
      if (p) {
        p.loading = 0;
        p.itemPause = 0;
      }
      return l;
    };
    return { game, make };
  }

  const run = (game: Game, id: string): { runs: ReconcileRunView[]; text?: string } | null => {
    sent.length = 0;
    game.intent(id, { t: "reconcileRun", seq: 4 });
    const r = sent.find((s) => s.to === id && s.msg.t === "reconcile")?.msg;
    return r?.t === "reconcile" ? { runs: r.runs, ...(r.text ? { text: r.text } : {}) } : null;
  };

  /** An admin's `/drop`, facing `facing` (a tile holding anything refuses it). */
  const adminDrop = (game: Game, id: string, text: string, facing: "N" | "S" | "E" | "W") => {
    const p = game.world.players.get(id);
    if (p) {
      p.facing = facing;
    }
    game.intent(id, { t: "chat", text: `/drop ${text}` });
  };

  /** A run's line for one item (every line, not only the flagged ones). */
  const line = (runId: string, item: string) =>
    db
      .query<
        { baseline: number; made: number; ended: number; unlogged: number; actual: number },
        [string, string]
      >(
        "SELECT baseline, made, ended, unlogged, actual, difference FROM reconcile_items WHERE run_id = ? AND item = ? COLLATE NOCASE",
      )
      .get(runId, item);

  test("the first run takes the baseline; a world whose changes were all logged reconciles to zero", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const first = run(game, god.characterId);
    expect(first?.runs).toHaveLength(1);
    expect(first?.runs[0]).toMatchObject({ baseline: true, by: "God", mismatches: 0, rows: [] });
    expect(first?.text).toBe("The first run took the baseline: the next run compares with it.");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("not online");
    }
    // Al eats an Apple, drops one and picks it up again; an admin's /drop makes gold and Apples.
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 2 });
    p.char.hunger = 0;
    game.intent(al.characterId, { t: "use", slot: 1 });
    p.itemPause = 0;
    game.intent(al.characterId, { t: "drop", slot: 1 });
    p.itemPause = 0;
    const dropped = p.map.ground.find((g) => g.item === "Apple");
    expect(dropped).toBeDefined();
    game.intent(al.characterId, { t: "pickup", id: dropped?.id ?? "" });
    adminDrop(game, god.characterId, "3 Apple", "E");
    adminDrop(game, god.characterId, "25 gold", "S");
    game.tick();
    wall += 60_000;
    const second = run(game, god.characterId);
    expect(second?.text).toBe("Every item's count matches what the log expects.");
    expect(second?.runs.map((r) => r.mismatches)).toEqual([0, 0]);
    expect(second?.runs[0]?.rows).toEqual([]);
    const id = second?.runs[0]?.id ?? "";
    const before = runCounts(db, first?.runs[0]?.id ?? "").get("apple")?.n ?? 0;
    // The eaten Apple ended; the /drop's three were made; the drop and pickup only moved one.
    expect(line(id, "Apple")).toMatchObject({ baseline: before, made: 3, ended: 1, unlogged: 0 });
    expect(line(id, "Apple")?.actual).toBe(before + 2);
    expect(line(id, "Gold")).toMatchObject({ made: 25, ended: 0 });
    // The run is audited.
    expect(recentAudit(db, 5).some((a) => a.command === "reconcile")).toBe(true);
  });

  test("a dupe shows as a difference: an item put in an offline bag with no log row", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    run(game, god.characterId);
    game.leave(al.characterId);
    db.query(
      "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
    ).run("dupe", al.characterId, 15, "Steel Sword", 2);
    wall += 60_000;
    const r = run(game, god.characterId);
    expect(r?.text).toBe("1 item's count differs from what the log expects.");
    expect(r?.runs[0]?.rows).toEqual([
      {
        item: "Steel Sword",
        currency: false,
        baseline: 0,
        made: 0,
        ended: 0,
        unlogged: 0,
        expected: 0,
        actual: 2,
        difference: 2,
      },
    ]);
    // The next run starts from this one's count: nothing more differs.
    wall += 60_000;
    const next = run(game, god.characterId);
    expect(next?.runs[0]).toMatchObject({ mismatches: 0, rows: [] });
    expect(line(next?.runs[0]?.id ?? "", "Steel Sword")).toMatchObject({ baseline: 2, actual: 2 });
  });

  test("an online dupe is logged as unlogged and shown beside its difference", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    run(game, god.characterId);
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("not online");
    }
    p.char.bag[14] = { item: "Gold Ring", qty: 1 };
    p.char.gold += 70;
    wall += 60_000;
    const rows = run(game, god.characterId)?.runs[0]?.rows ?? [];
    expect(rows.map((r) => [r.item, r.unlogged, r.expected, r.actual, r.difference])).toEqual([
      ["Gold", 70, expect.any(Number), expect.any(Number), 70],
      ["Gold Ring", 1, 0, 1, 1],
    ]);
  });

  test("a run reads only the rows since the last one, so pruned rows never matter", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    await make("Al");
    run(game, god.characterId);
    adminDrop(game, god.characterId, "2 Apple", "E");
    game.tick();
    wall += 60_000;
    const second = run(game, god.characterId)?.runs[0];
    expect(second?.mismatches).toBe(0);
    // Every row is pruned: the third run compares with the second's count and finds nothing.
    db.query("DELETE FROM activity_log").run();
    wall += 60_000;
    const third = run(game, god.characterId)?.runs[0];
    expect(third?.mismatches).toBe(0);
    expect(line(third?.id ?? "", "Apple")).toMatchObject({
      baseline: line(second?.id ?? "", "Apple")?.actual,
      made: 0,
    });
    // A row written after it is read by the next run alone.
    adminDrop(game, god.characterId, "Apple", "S");
    game.tick();
    wall += 60_000;
    const fourth = run(game, god.characterId)?.runs[0];
    expect(fourth?.mismatches).toBe(0);
    expect(line(fourth?.id ?? "", "Apple")).toMatchObject({ made: 1 });
  });

  test("the query answers the newest runs, newest first; without the permission nothing runs", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    sent.length = 0;
    game.intent(god.characterId, { t: "reconcileQuery", seq: 9 });
    expect(sent.find((s) => s.msg.t === "reconcile")?.msg).toEqual({
      t: "reconcile",
      seq: 9,
      runs: [],
    });
    run(game, god.characterId);
    wall += 60_000;
    run(game, god.characterId);
    sent.length = 0;
    game.intent(god.characterId, { t: "reconcileQuery", seq: 10 });
    const r = sent.find((s) => s.msg.t === "reconcile")?.msg;
    expect(r?.t === "reconcile" ? r.runs.map((x) => x.baseline) : null).toEqual([false, true]);
    sent.length = 0;
    game.intent(al.characterId, { t: "reconcileRun", seq: 1 });
    game.intent(al.characterId, { t: "reconcileQuery", seq: 2 });
    expect(sent.filter((s) => s.msg.t === "reconcile")).toEqual([]);
    expect(recentRuns(db, 10)).toHaveLength(2);
  });

  test("a bid's rows commit with the stake it saved: a crash before the next tick still reconciles", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const bo = await make("Bo");
    const a = game.world.players.get(al.characterId);
    const b = game.world.players.get(bo.characterId);
    if (!a || !b) {
      throw new Error("not online");
    }
    a.char.gold = 100;
    b.char.gold = 100;
    run(game, god.characterId);
    const table: GroundItem = {
      id: "t",
      item: "Blackjack Table",
      x: a.x + 1,
      y: a.y,
      kind: "drop",
      expiresAt: null,
    };
    bjSit(game.world, a, table);
    bjSit(game.world, b, table);
    game.intent(al.characterId, { t: "bjBid", text: "40" });
    expect(a.char.gold).toBe(60);
    // The crash: no tick, no shutdown. The restart refunds the stake its saved purse holds.
    const again = start();
    again.game.enter(god.characterId, false, "10.0.0.7");
    wall += 60_000;
    const r = run(again.game, god.characterId);
    expect(r?.runs[0]).toMatchObject({ mismatches: 0, rows: [] });
    expect(line(r?.runs[0]?.id ?? "", "Gold")).toMatchObject({ made: 40, ended: 40 });
  });

  test("retention never prunes a row the next run has still to read", async () => {
    saveSettingOverride(db, "activityLogRetention", 12 * 3600, "");
    const { game, make } = start();
    const god = await make("God", "administrator");
    run(game, god.characterId);
    const baselineSeq = recentRuns(db, 1)[0]?.lastSeq ?? 0;
    wall += 60_000;
    adminDrop(game, god.characterId, "2 Apple", "E");
    // Thirteen hours on, the hourly prune runs: the rows before the run go, the drop stays.
    wall += 13 * 3_600_000;
    game.tick();
    const left = (sql: string) =>
      (db.query<{ n: number }, [number]>(sql).get(baselineSeq) as { n: number }).n;
    expect(left("SELECT COUNT(*) AS n FROM activity_log WHERE seq <= ?")).toBe(0);
    expect(left("SELECT COUNT(*) AS n FROM activity_log WHERE seq > ? AND type = 'admin'")).toBe(1);
    // The same at a restart, before the nightly run could catch up.
    start();
    expect(left("SELECT COUNT(*) AS n FROM activity_log WHERE seq > ? AND type = 'admin'")).toBe(1);
    const second = run(game, god.characterId)?.runs[0];
    expect(second?.mismatches).toBe(0);
    expect(line(second?.id ?? "", "Apple")).toMatchObject({ made: 2 });
    // Once a run has read it, it is pruned like any other row.
    wall += 13 * 3_600_000;
    game.tick();
    expect(left("SELECT COUNT(*) AS n FROM activity_log WHERE seq > ? AND type = 'admin'")).toBe(0);
  });

  test("the currency's name in the item flow shows every change to the gold, with its totals", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    adminDrop(game, god.characterId, "25 gold", "S");
    sent.length = 0;
    game.intent(god.characterId, {
      t: "activityQuery",
      seq: 3,
      scope: "item",
      name: "gold",
      types: [],
      since: null,
      until: null,
      before: null,
      limit: 50,
    });
    const r = sent.find((x) => x.msg.t === "activity")?.msg;
    expect(r?.t === "activity" ? r.rows.map((x) => [x.type, x.details?.placedGold]) : null).toEqual(
      [["admin", 25]],
    );
    expect(r?.t === "activity" ? r.totals : null).toEqual([
      { type: "admin", gained: 25, lost: 0, rows: 1 },
    ]);
  });

  test("a run sums a large log in SQL: what reaches the game is one line per item and type", () => {
    // 200,000 rows of 10 items over 4 types, written straight to the table.
    db.run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200000)
       INSERT INTO activity_log (id, created_at, type, account_id, character_id, character, item, qty, gold, details)
       SELECT 'r' || i, '2026-11-22T09:00:00.000Z',
         CASE i % 4 WHEN 0 THEN 'buy' WHEN 1 THEN 'use' WHEN 2 THEN 'trade' ELSE 'loot' END,
         'a', 'c', 'Al', 'Item ' || (i % 10),
         CASE i % 4 WHEN 0 THEN 1 WHEN 1 THEN -1 WHEN 2 THEN -1 ELSE 0 END,
         CASE i % 4 WHEN 0 THEN -3 ELSE 0 END,
         CASE i % 4 WHEN 3 THEN '{"placed":2}' ELSE NULL END
       FROM n`,
    );
    const started = performance.now();
    const flows = activityFlows(db, 0, 1_000_000, "Gold");
    const took = performance.now() - started;
    // 50,000 buys (+1 each), 50,000 uses (-1), trades moved nothing, 50,000 loot (+2 placed).
    const items = [...flows.values()].filter((f) => f.item !== "Gold");
    expect(items).toHaveLength(10);
    expect(items.reduce((n, f) => n + f.made, 0)).toBe(150_000);
    expect(items.reduce((n, f) => n + f.ended, 0)).toBe(50_000);
    expect(flows.get("")).toMatchObject({ made: 0, ended: 150_000 });
    expect(took).toBeLessThan(5_000);
  });

  test("the nightly run starts at the first tick after 04:00 UTC, once a day", async () => {
    wall = Date.parse("2026-11-22T03:58:00.000Z");
    const { game, make } = start({ nightly: true });
    await make("Al");
    game.tick();
    expect(recentRuns(db, 5)).toEqual([]);
    wall = Date.parse("2026-11-22T04:00:30.000Z");
    game.tick();
    expect(recentRuns(db, 5).map((r) => [r.by, r.baseline])).toEqual([[null, true]]);
    wall += 120_000;
    game.tick();
    expect(recentRuns(db, 5)).toHaveLength(1);
    wall = Date.parse("2026-11-23T04:01:00.000Z");
    game.tick();
    expect(recentRuns(db, 5).map((r) => [r.by, r.baseline])).toEqual([
      [null, false],
      [null, true],
    ]);
  });

  test("a nightly run that fails rolls back alone and is tried again a minute later", async () => {
    wall = Date.parse("2026-11-22T04:00:30.000Z");
    const { game, make } = start({ nightly: true });
    await make("Al");
    wall += 61_000;
    boom = true;
    game.tick();
    boom = false;
    expect(faults).toBeGreaterThan(0);
    expect(recentRuns(db, 5)).toEqual([]);
    game.tick();
    expect(recentRuns(db, 5)).toEqual([]);
    wall += 61_000;
    game.tick();
    expect(recentRuns(db, 5).map((r) => r.baseline)).toEqual([true]);
  });

  test("a decay logged as a map loads goes with the call that rolled back", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const p = game.world.players.get(god.characterId);
    const mapId = p?.map.id ?? "";
    insertGround(
      db,
      {
        id: "old-loot",
        mapId,
        x: 2,
        y: 2,
        item: "Apple",
        qty: 1,
        kind: "loot",
        expiresAt: "2026-11-22T08:00:00.000Z",
      },
      "2026-11-22T07:00:00.000Z",
    );
    game.leave(god.characterId);
    // A fresh game loads the map on entry; the entry's writes fail and roll back.
    const again = start();
    boom = true;
    again.game.enter(god.characterId, false, "10.0.0.7");
    boom = false;
    again.game.tick();
    const decays = () =>
      db
        .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM activity_log WHERE type = 'decay'")
        .get()?.n;
    expect(decays()).toBe(0);
    // Loaded again, it decays once.
    const third = start();
    third.game.enter(god.characterId, false, "10.0.0.7");
    third.game.tick();
    expect(decays()).toBe(1);
  });

  test("a blackjack stake held at a crash is refunded with a reward row on restart", async () => {
    const { make } = start();
    const al = await make("Al");
    saveCasinoHolds(db, new Map([[al.characterId, 40]]));
    start();
    const rows = db
      .query<{ type: string; character: string; gold: number; details: string }, []>(
        "SELECT type, character, gold, details FROM activity_log WHERE type = 'reward' AND gold != 0",
      )
      .all();
    expect(rows).toEqual([
      {
        type: "reward",
        character: "Al",
        gold: 40,
        details: JSON.stringify({ game: "blackjack", refund: true, restart: true }),
      },
    ]);
    expect(db.query("SELECT COUNT(*) AS n FROM casino_holds").get()).toEqual({ n: 0 });
  });

  test("a stake held at a table is not counted: the log spent it at the bid", async () => {
    const { make } = start();
    const al = await make("Al");
    const gold = countHoldings(db, "Gold").get("")?.n ?? 0;
    saveCasinoHolds(db, new Map([[al.characterId, 15]]));
    expect(countHoldings(db, "Gold").get("")?.n).toBe(gold - 15);
  });

  test("loot that decayed while its map was not loaded is logged when the map loads", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const p = game.world.players.get(god.characterId);
    const mapId = p?.map.id ?? "";
    const name = p?.map.name ?? "";
    insertGround(
      db,
      {
        id: "old-loot",
        mapId,
        x: 2,
        y: 2,
        item: "3 Red Crystal",
        qty: 1,
        kind: "loot",
        expiresAt: "2026-11-22T08:00:00.000Z",
      },
      "2026-11-22T07:00:00.000Z",
    );
    run(game, god.characterId);
    // Everyone leaves; the cached map is forgotten, as after a restart, so the next entry loads it.
    game.leave(god.characterId);
    const again = start();
    again.game.enter(god.characterId, false, "10.0.0.7");
    again.game.tick();
    const decayed = db
      .query<
        { type: string; item: string; qty: number; map: string; character: string | null },
        []
      >("SELECT type, item, qty, map, character FROM activity_log WHERE type = 'decay'")
      .all();
    expect(decayed).toEqual([
      { type: "decay", item: "Red Crystal", qty: -3, map: name, character: null },
    ]);
    wall += 60_000;
    expect(run(again.game, god.characterId)?.runs[0]?.mismatches).toBe(0);
  });
});

describe("world events", () => {
  test("loot decaying on a loaded map is logged, gold as gold", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    s.join(player("a", map, 9, 9));
    map.ground.push(
      { id: "l1", item: "Apple", qty: 2, x: 3, y: 4, kind: "loot", expiresAt: 10 },
      { id: "l2", item: "15 Gold", x: 4, y: 4, kind: "loot", expiresAt: 10 },
      { id: "l3", item: "Pear", x: 5, y: 4, kind: "loot", expiresAt: 999 },
    );
    decayLoot({ world: s.world, rng: rngByN(), now: 100 });
    expect(
      s.world.activity.map((e) => [e.type, e.character, e.item, e.qty, e.gold, e.x, e.y]),
    ).toEqual([
      ["decay", null, "Apple", -2, 0, 3, 4],
      ["decay", null, null, 0, -15, 4, 4],
    ]);
  });

  test("regrowth's produce is logged", () => {
    const map = testMap("x1000y992");
    const row = (map.layers[1][3] ?? "").split(" ");
    row[2] = "XL";
    map.layers[1][3] = row.join(" ");
    const s = setup([map], undefined, rngByN({ 600: [9], 17: [1, 3], 12: [1, 4] }));
    s.join(player("a", map, 9, 9));
    s.run(1);
    expect(s.world.activity.map((e) => [e.type, e.character, e.item, e.qty, e.x, e.y])).toEqual([
      ["regrow", null, "Corn", 1, 3, 4],
    ]);
  });

  test("a quest chest refilled by the periodic save is logged", () => {
    const map = testMap("x1000y992");
    const world = createWorld();
    const p = player("a", map, 5, 5);
    p.saveBlock = 0;
    saveClockStep(world, p, rngByN({ 350: [1], 4000: [1], 6: [1], 2: [1] }));
    expect(world.containers.get("Gold Chest")).toEqual(["Thor's Hammer"]);
    expect(world.activity.map((e) => [e.type, e.character, e.other, e.item, e.qty])).toEqual([
      ["refill", null, "Gold Chest", "Thor's Hammer", 1],
    ]);
  });

  test("a demolished house logs its vault's contents and its outdoor items as destroyed", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    s.join(player("a", map, 9, 9));
    const room = s.world.rooms.get(map.name) as Room;
    s.world.houses.set("xH11000yH1992", {
      ownerId: "bob",
      ownerName: "Bob",
      map: map.name,
      item1: { item: "Bob's Mailbox", x: 3, y: 3 },
      item2: { item: "Stove", x: 4, y: 3 },
      tiles: [],
      interior: "xH11000yH1992",
    });
    room.map.ground.push(
      { id: "m", item: "Bob's Mailbox", x: 3, y: 3, kind: "drop", expiresAt: null },
      { id: "s", item: "Stove", x: 4, y: 3, kind: "drop", expiresAt: null },
    );
    s.world.containers.set("Bob's House Vault", ["Apple", "Apple", "40 Gold", "2 Blue Crystal"]);
    demolish(s.world, "xH11000yH1992", (n) => s.world.rooms.get(n)?.map ?? null);
    expect(
      s.world.activity.map((e) => [e.type, e.character, e.item, e.qty, e.gold, e.details?.house]),
    ).toEqual([
      ["demolish", null, "Stove", -1, 0, "xH11000yH1992"],
      ["demolish", null, "Apple", -2, 0, "xH11000yH1992"],
      ["demolish", null, null, 0, -40, "xH11000yH1992"],
      ["demolish", null, "Blue Crystal", -2, 0, "xH11000yH1992"],
    ]);
  });

  test("a Cauldron's brew is logged as made and used up in storage", () => {
    const map = testMap("x1000y992");
    const world = createWorld();
    const p = player("a", map, 5, 5);
    addPlayer(world, p);
    p.char.bag[0] = { item: "Silver Crown", qty: 1 };
    world.containers.set("Cauldron#5", ["Chunk of Star"]);
    depositContainer(world, p, 1, "Cauldron#5");
    expect(world.containers.get("Cauldron#5")).toEqual(["Gold Crown"]);
    expect(world.activity.map((e) => [e.type, e.item, e.qty, e.details?.stored ?? null])).toEqual([
      ["container", "Silver Crown", -1, null],
      ["craft", "Gold Crown", 0, 1],
      ["craft", "Chunk of Star", 0, -1],
      ["craft", "Silver Crown", 0, -1],
    ]);
  });

  test("a name that is not counted logs nothing", () => {
    const world = createWorld();
    logWorld(world, "decay", "Exit", -1);
    logWorld(world, "decay", "Bob's Door", -1);
    logWorld(world, "decay", "Apple", 0);
    expect(world.activity).toEqual([]);
  });
});
