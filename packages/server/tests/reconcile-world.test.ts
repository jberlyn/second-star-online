/**
 * Item reconciliation over a closed world (issue #35): many systems move, make and destroy items
 * and gold through the real game, and a run afterwards finds every count where the log says it
 * should be. Also: migration 71 keeps the old activity rows in order, and the runs kept and the
 * lines shown are capped.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  RECONCILE_ROWS_MAX,
  RECONCILE_RUNS_KEPT,
  type ReconcileItem,
  type ServerMsg,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";
import { insertRun, recentRuns, runView } from "../src/persistence/reconcile.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import { depositContainer } from "../src/systems/economy/containers.ts";
import { questGive } from "../src/systems/economy/quests.ts";
import { depositVault, withdrawVault } from "../src/systems/economy/vault.ts";
import type { Player } from "../src/systems/world/world.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let now: string;
let sent: { to: string; msg: ServerMsg }[];
const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  prepareScenarioMap(db);
  db.run("UPDATE maps SET layer1 = ?", [JSON.stringify(Array.from({ length: 12 }, () => ROW_8R))]);
  now = "2026-11-05T09:00:00.000Z";
  sent = [];
});

const game = (queues: Record<number, number[]> = {}): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => now,
    rng: rngByN(queues),
    minute: () => 0,
    onFault: (where, err) => {
      throw new Error(`${where}: ${String(err)}`);
    },
  });

async function makeChar(g: Game, name: string, admin = false): Promise<{ id: string; p: Player }> {
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
  if (admin) {
    setRole(db, l.accountId, "administrator", now);
  }
  g.enter(l.characterId, false);
  g.intent(l.characterId, { t: "mapReady" });
  const p = g.world.players.get(l.characterId);
  if (!p) {
    throw new Error("not in");
  }
  p.loading = 0;
  return { id: l.characterId, p };
}

const ready = (p: Player) => {
  p.itemPause = 0;
  p.stepFrames = 0;
  p.chatIn = 0;
};

/** Runs a reconciliation as `id` and returns the newest run's flagged lines. */
function reconcile(g: Game, id: string): { mismatches: number; rows: ReconcileItem[] } {
  sent = [];
  g.intent(id, { t: "reconcileRun", seq: 1 });
  const r = sent.find((s) => s.msg.t === "reconcile")?.msg;
  const run = r?.t === "reconcile" ? r.runs[0] : undefined;
  if (!run) {
    throw new Error("no run");
  }
  return { mismatches: run.mismatches, rows: run.rows };
}

function setTile(p: Player, x: number, y: number, code: string) {
  const row = (p.map.layers[0][y - 1] ?? "").split(" ");
  row[x - 1] = code;
  p.map.layers[0][y - 1] = row.join(" ");
}

describe("a closed world", () => {
  test("every system's changes are logged: a run finds no difference", async () => {
    // The first prize lands in a full bag and is lost.
    saveSettingOverride(db, "assassinPrizes", ["Chunk of Iron", "", "", ""], "");
    let g = game();
    const god = await makeChar(g, "God", true);
    const carol = await makeChar(g, "Carol");
    const ann = await makeChar(g, "Ann");
    const a = ann.p;
    const c = carol.p;
    // What the scene starts with is unlogged setup, taken in by the baseline.
    c.char.bag[2] = { item: "Small Shop Deed", qty: 1 };
    c.char.gold = 100;
    a.char.gold = 500;
    a.char.bank = 0;
    a.char.storeDirty = true;
    const fill = [
      "Apple",
      "Knife",
      "Silver Crown",
      "Newspaper Kit",
      "Airship Deed",
      "Chunk of Fire",
      "Chunk of Ice",
      "Chunk of Steel",
      "Axe",
      "Anvil",
      "Ale",
      "Book",
      "Chair",
      "Camera",
      "Clarinet",
    ];
    a.char.bag = fill.map((item) => ({ item, qty: item === "Apple" ? 5 : 1 }));
    g.world.containers.set("Cauldron#5", ["Chunk of Star"]);
    g.world.containersDirty.add("Cauldron#5");
    g.world.questLines[0] = "Agavar:Ale:Axe";
    g.world.questsDirty.add(0);
    g.tick();
    expect(reconcile(g, god.id).mismatches).toBe(0);

    // The Assassin's game ends with Ann first and her bag full: the prize is lost, not made.
    g.world.assassin.mode = "GO";
    g.world.assassin.current = [{ id: ann.id, name: "Ann", points: 3 }];
    g.intent(god.id, { t: "assassinGame", mode: "STOP" });
    expect(a.char.bag.some((l) => l?.item === "Chunk of Iron")).toBe(false);

    // Quests: Ale handed to Agavar for an Axe.
    const ale = a.char.bag.findIndex((l) => l?.item === "Ale");
    questGive(g.world, a, ale, "Agavar", rngByN());
    g.tick();

    // The vault: one Chair in, then out again; one Chunk of Fire stays in.
    a.vaultOpen = true;
    const slot = (item: string) => a.char.bag.findIndex((l) => l?.item === item) + 1;
    depositVault(g.world, a, slot("Chair"));
    depositVault(g.world, a, slot("Chunk of Fire"));
    withdrawVault(g.world, a, 1, rngByN());
    a.vaultOpen = false;
    // A Cauldron: the Silver Crown and the Chunk of Star brew a Gold Crown.
    depositContainer(g.world, a, slot("Silver Crown"), "Cauldron#5");
    expect(g.world.containers.get("Cauldron#5")).toEqual(["Gold Crown"]);
    g.tick();

    // A newspaper stand on a K2 tile, facing east.
    a.facing = "E";
    setTile(a, a.x + 1, a.y, "K2");
    ready(a);
    g.intent(ann.id, { t: "drop", slot: slot("Newspaper Kit") });
    expect(a.map.ground.some((x) => x.item === "Ann's Newspaper")).toBe(true);

    // An Airship built on a pad, boarded and parked again.
    a.facing = "W";
    setTile(a, a.x - 1, a.y, "J2");
    ready(a);
    g.intent(ann.id, { t: "use", slot: slot("Airship Deed") });
    ready(a);
    g.intent(ann.id, { t: "action" });
    expect(a.vehicle).toBe("Airship");
    ready(a);
    g.intent(ann.id, { t: "action" });
    expect(a.vehicle).toBeNull();
    g.tick();

    // Carol builds a Small Shop at (10, 4) and walks in; Ann follows.
    ready(c);
    g.intent(carol.id, { t: "use", slot: 3 });
    g.intent(carol.id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    for (const p of [c, a]) {
      p.x = 10;
      p.y = 5;
      p.vehicle = null;
      g.tick();
      g.intent(p.id, { t: "mapReady" });
      p.loading = 0;
      ready(p);
    }
    expect(c.map.name).toBe("xH11000yH1992");
    c.y = 9;
    g.intent(carol.id, { t: "chat", text: "Zumu set Fish=5,2" });
    // Carol gives the till 40; Ann sells Apples to the shop and buys one back.
    c.x = 10;
    c.y = 5;
    c.facing = "N";
    ready(c);
    g.intent(carol.id, { t: "gold", n: 40 });
    const ledger = g.world.shops.get("Zumu");
    const line = (kind: "SEL" | "BUY", item: string) =>
      ledger?.lines.find((l) => l.kind === kind && l.item === item)?.line ?? 0;
    a.shop = { npc: "Zumu", mode: "sell" };
    g.intent(ann.id, { t: "sell", line: line("BUY", "Apple"), count: 3 });
    a.shop = { npc: "Zumu", mode: "buy" };
    g.intent(ann.id, { t: "buy", line: line("SEL", "Apple"), count: 1 });
    expect(
      g.world.shops.get("Zumu")?.lines.find((l) => l.item === "Apple" && l.kind === "SEL")?.stock,
    ).toBe(2);
    g.tick();

    // The character editor gives Ann gold and puts some in her bank.
    sent = [];
    g.intent(god.id, {
      t: "characterEdit",
      seq: 1,
      name: "Ann",
      set: { gold: a.char.gold + 25, bank: 300 },
      seen: { gold: a.char.gold, bank: a.char.bank ?? 0 },
      override: false,
      reason: "test",
    });
    expect(a.char.bank).toBe(300);

    // A content removal purges every Knife, with 3 gold back each.
    db.transaction(() =>
      g.contentWorld.apply(
        [
          {
            kind: "item",
            key: "Knife",
            spellings: ["Knife"],
            copies: "purge",
            replacement: null,
            refundGold: 3,
          },
        ],
        { accountId: "op", name: "Operator" },
        "pub-1",
      ),
    )();
    g.tick();
    const mid = reconcile(g, god.id);
    expect(mid.rows).toEqual([]);

    // Two months on, the shop is demolished with its stock and till.
    for (const id of [ann.id, carol.id, god.id]) {
      g.leave(id);
    }
    now = "2027-01-10T09:00:00.000Z";
    g = game({ 50: [2, 1] });
    const bo = await makeChar(g, "Bo", true);
    g.tick();
    expect(g.world.playerShops.size).toBe(0);
    const end = reconcile(g, bo.id);
    expect(end.rows).toEqual([]);
    // Each system did log its part.
    const types = new Set(
      db
        .query<{ type: string }, []>("SELECT DISTINCT type FROM activity_log")
        .all()
        .map((r) => r.type),
    );
    for (const t of [
      "reward",
      "quest",
      "vault",
      "container",
      "craft",
      "use",
      "playerShop",
      "admin",
      "demolish",
    ]) {
      expect(types.has(t)).toBe(true);
    }
    expect(a.char.bag.some((l) => l?.item === "Knife")).toBe(false);
  });
});

describe("the runs", () => {
  test("migration 71 keeps the old activity rows, in order, and numbers them", () => {
    const old = openDatabase();
    const all = loadMigrations();
    runMigrations(
      old,
      all.filter((m) => m.name < "20261125_71"),
    );
    old.run(
      `INSERT INTO activity_log (id, created_at, type, account_id, character_id, character, item, qty)
       VALUES ('b', '2026-11-02T00:00:00.000Z', 'drop', 'a', 'c', 'Al', 'Apple', -1),
              ('a', '2026-11-01T00:00:00.000Z', 'buy', 'a', 'c', 'Al', 'Apple', 2)`,
    );
    runMigrations(old, all);
    expect(
      old.query("SELECT seq, id, type, character, item, qty FROM activity_log ORDER BY seq").all(),
    ).toEqual([
      { seq: 1, id: "a", type: "buy", character: "Al", item: "Apple", qty: 2 },
      { seq: 2, id: "b", type: "drop", character: "Al", item: "Apple", qty: -1 },
    ]);
  });

  const item = (n: number): ReconcileItem => ({
    item: `Item ${n}`,
    currency: false,
    baseline: 0,
    made: 0,
    ended: 0,
    unlogged: 0,
    expected: 0,
    actual: 1,
    difference: 1,
  });

  test("a run shows at most RECONCILE_ROWS_MAX lines, saying how many more", () => {
    const run = {
      id: "r",
      at: "2026-11-05T09:00:00.000Z",
      by: null,
      lastSeq: 0,
      baseline: false,
      items: RECONCILE_ROWS_MAX + 7,
      mismatches: RECONCILE_ROWS_MAX + 7,
    };
    insertRun(
      db,
      run,
      Array.from({ length: RECONCILE_ROWS_MAX + 7 }, (_, i) => item(i)),
    );
    const view = runView(db, run);
    expect(view.rows).toHaveLength(RECONCILE_ROWS_MAX);
    expect(view.more).toBe(7);
  });

  test("only the newest RECONCILE_RUNS_KEPT runs are kept, their lines with them", () => {
    for (let i = 0; i < RECONCILE_RUNS_KEPT + 3; i++) {
      const at = new Date(Date.parse("2026-11-01T00:00:00.000Z") + i * 60_000).toISOString();
      insertRun(
        db,
        { id: `r${i}`, at, by: null, lastSeq: i, baseline: i === 0, items: 1, mismatches: 1 },
        [item(i)],
      );
    }
    const kept = recentRuns(db, 1000);
    expect(kept).toHaveLength(RECONCILE_RUNS_KEPT);
    expect(kept.at(-1)?.id).toBe("r3");
    expect(db.query("SELECT COUNT(*) AS n FROM reconcile_items").get()).toEqual({
      n: RECONCILE_RUNS_KEPT,
    });
  });
});
