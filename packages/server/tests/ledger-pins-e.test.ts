/**
 * Pins for docs/differences-from-fso.md: gives and gathering past the old 20-item screen limit, the
 * audit log's editor saves, id-addressed editor loads, server faults, crafted Cauldron ids and the
 * carried-container re-check.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type DeltaEvent,
  type ServerMsg,
  skillIndex,
  TEXT,
  tileAt,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { startServer, TICK_FAILURE_LIMIT } from "../src/main.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadNewspaper } from "../src/persistence/newspapers.ts";
import { setAttackHeld } from "../src/systems/combat/melee.ts";
import { craftStep } from "../src/systems/crafting/craft.ts";
import { storageIntent, withdrawContainer } from "../src/systems/economy/containers.ts";
import { giveIntent, type ItemCtx } from "../src/systems/inventory/items.ts";
import { boardCloseIntent } from "../src/systems/mail/boards.ts";
import type { Room, WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "delta" ? o.msg.events : []));

/** `n` player drops spread over the map, away from (5..6, 5..6). */
function crowd(map: WorldMap, n: number) {
  for (let i = 0; i < n; i++) {
    map.ground.push({
      id: `g${i}`,
      item: "Apple",
      x: (i % 17) + 1,
      y: Math.floor(i / 17) + 9,
      kind: "drop",
      expiresAt: null,
    });
  }
}

describe("No per-map ground-item slot limit", () => {
  test("design change: a give onto a map already holding 25 ground items lands and is grabbed", () => {
    const map = testMap("x1000y992");
    crowd(map, 25);
    const s = setup([map], undefined, rngByN());
    const a = player("A", map, 5, 5);
    const b = player("B", map, 6, 5);
    s.join(a);
    s.join(b);
    a.facing = "E";
    a.char.bag[0] = { item: "Knife", qty: 1 };
    const room = s.world.rooms.get(map.name) as Room;
    const ctx: ItemCtx = { world: s.world, rng: rngByN(), now: 0 };
    const out = giveIntent(ctx, room, a, 1);
    expect(map.ground).toHaveLength(26);
    expect(map.ground.at(-1)).toMatchObject({ item: "Knife", x: 6, y: 5 });
    expect(events(out, "B").some((e) => e.e === "gadd")).toBe(true);
    s.run(60);
    expect(b.char.bag[0]).toEqual({ item: "Knife", qty: 1 });
    expect(map.ground).toHaveLength(25);
  });

  test("design change: a felled tree drops its logs on a map already holding 25 ground items", () => {
    const map = testMap("x1000y992", [[5, 5]]);
    crowd(map, 25);
    // random(3) is hunger's roll every tick; random(12) = 1 drops the logs.
    const s = setup([map], undefined, rngByN({ 3: Array(2000).fill(1), 12: [1] }));
    const a = player("a", map, 5, 6);
    a.char.equip.weapon = "Axe";
    a.char.skills[skillIndex("Lumberjacking")] = 5;
    a.gather.Axe = 1; // the next hit fells it
    s.join(a);
    setAttackHeld(a, true);
    for (let i = 0; i < 40 && tileAt(map.layers[1], 5, 5) !== "P3"; i++) {
      s.run(1);
    }
    setAttackHeld(a, false);
    expect(tileAt(map.layers[1], 5, 5)).toBe("P3");
    expect(map.ground).toHaveLength(26);
    expect(map.ground.at(-1)).toMatchObject({ item: "Logs", x: 5, y: 5, kind: "loot" });
  });
});

/** A real game on in-memory SQL with one administrator, Al, entered on the map. */
async function adminGame(opts: { crashPoint?: (label: string) => void } = {}) {
  const db: Db = openDatabase();
  migrate(db);
  const sent: Out = [];
  const kicked: { id: string; text: string | undefined }[] = [];
  const faults: string[] = [];
  const game: Game = createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => "2026-11-20T00:00:00.000Z",
    rng: rngByN(),
    minute: () => 0,
    kick: (id, text) => kicked.push({ id, text }),
    onFault: (where) => faults.push(where),
    crashPoint: opts.crashPoint,
  });
  const make = async (name: string, role: "administrator" | null) => {
    await game.create({
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
    const l = await game.login(name, "pw");
    if (!l.ok) {
      throw new Error(l.text);
    }
    if (role) {
      setRole(db, l.accountId, role, "2026-11-20T00:00:00.000Z");
    }
    game.enter(l.characterId, false);
    game.intent(l.characterId, { t: "mapReady" });
    return l.characterId;
  };
  return { db, sent, kicked, faults, game, make };
}

describe("Server-side roles, admin commands and editors", () => {
  test("SSO: World Editor and NPC Editor saves are in audit_log; a newspaper save is not", async () => {
    const { db, sent, game, make } = await adminGame();
    const al = await make("Al", "administrator");
    expect(recentAudit(db, 50)).toEqual([]);

    game.intent(al, { t: "editOpen" });
    const ed = sent.findLast((m) => m.msg.t === "editor")?.msg;
    if (ed?.t !== "editor" || !ed.editing) {
      throw new Error("no editor");
    }
    game.intent(al, { t: "editSave", map: { ...ed.map, header: "Audited" } });
    expect(sent.at(-1)?.msg.t).toBe("alert");
    game.intent(al, { t: "editClose" });

    game.intent(al, { t: "npcEditOpen" });
    game.intent(al, { t: "npcSave", name: "Amber", text: "BIO|Name: Amber\nGLD|5\n" });
    expect(sent.at(-1)?.msg).toEqual({ t: "alert", text: "NPC has been successfully saved." });

    expect(
      recentAudit(db, 50).map((r) => [r.actor, r.command, r.target, r.before, r.after]),
    ).toEqual([
      ["Al", "editSave", `x${ed.map.mx}y${ed.map.my}`, null, null],
      ["Al", "npcSave", "Amber", null, null],
    ]);

    // A newspaper save is stored but not audited.
    const bo = await make("Bo", null);
    const texts: [string, string, string, string, string, string] = [
      "T1",
      "T2",
      "T3",
      "T4",
      "T5",
      "T6",
    ];
    const paper = { photos: ["", "", ""], texts };
    game.intent(bo, { t: "newspaperSave", ...paper });
    expect(loadNewspaper(db, "Bo")?.texts).toEqual(paper.texts);
    expect(recentAudit(db, 50).map((r) => r.command)).toEqual(["editSave", "npcSave"]);
  });
});

describe("File editor and path-based file access removed", () => {
  test("SSO: an NPC Editor load names an NPC by id; a path names nothing and reads nothing", async () => {
    const { sent, game, make } = await adminGame();
    const al = await make("Al", "administrator");
    game.intent(al, { t: "npcEditOpen" });
    sent.length = 0;
    for (const name of [
      "../NPCs/Amber",
      "NPCs/Amber.txt",
      "/etc/passwd",
      "..\\Amber",
      "Amber.txt",
    ]) {
      game.intent(al, { t: "npcLoad", name });
    }
    expect(sent).toEqual([]);
    game.intent(al, { t: "npcLoad", name: "Amber" });
    expect(sent.at(-1)?.msg).toMatchObject({ t: "npcScript", name: "Amber" });
  });
});

describe("Server errors log the player out", () => {
  test("SSO: an intent that throws logs its sender out with the server-error text; nothing is written", async () => {
    let boom = false;
    const { db, kicked, faults, game, make } = await adminGame({
      crashPoint: (label) => {
        if (boom && label === "persist:mid") {
          throw new Error("test throw");
        }
      },
    });
    const bo = await make("Bo", null);
    const bag = () =>
      db
        .query("SELECT slot, item, qty FROM inventory WHERE character_id = ? ORDER BY slot")
        .all(bo);
    const before = bag();
    expect(before.length).toBeGreaterThan(0);
    boom = true;
    game.intent(bo, { t: "drop", slot: 1 });
    boom = false;
    expect(kicked).toEqual([{ id: bo, text: TEXT.serverError }]);
    expect(faults).toEqual(["intent drop from Bo"]);
    expect(game.isOnline(bo)).toBe(false);
    expect(bag()).toEqual(before);
    expect(db.query("SELECT COUNT(*) AS n FROM ground_items").get()).toEqual({ n: 0 });
    // A server fault is not cheating.
    expect(db.query("SELECT COUNT(*) AS n FROM cheat_log").get()).toEqual({ n: 0 });
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("SSO: 20 throwing ticks in a row save everyone and exit; a good tick resets the count", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-pins-e-"));
    dirs.push(dir);
    const clientDir = join(dir, "client");
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
    const dbPath = join(dir, "sso.sqlite");
    let t = 1000;
    const clock = { now: () => t };
    let boom = false;
    const exits: number[] = [];
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const server = startServer({
      dbPath,
      port: 0,
      development: false,
      clientDir,
      clock,
      isoNow: () => "2026-11-20T00:00:00.000Z",
      // Every tick rolls hunger's random(3) for an online player: the throw is certain.
      rng: {
        random: (n) => {
          if (boom) {
            throw new Error("test throw");
          }
          return n >= 1 ? n : 0;
        },
      },
      onFault: () => {},
      onLag: () => {},
      exit: (code) => exits.push(code),
    });
    try {
      const g = server.game;
      await g.create({
        t: "create",
        name: "Bo",
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
      const l = await g.login("Bo", "pw");
      if (!l.ok) {
        throw new Error(l.text);
      }
      g.enter(l.characterId, false);
      g.intent(l.characterId, { t: "mapReady" });
      // Count the loop's ticks and what each returned.
      const results: boolean[] = [];
      const real = g.tick.bind(g);
      g.tick = () => {
        const ok = real();
        results.push(ok);
        return ok;
      };
      /** Lets the running loop take `n` ticks, one 50 ms step at a time. */
      const ticks = async (n: number) => {
        for (let i = 0; i < n; i++) {
          const had = results.length;
          t += 50;
          for (let w = 0; w < 400 && results.length === had; w++) {
            await Bun.sleep(1);
          }
          expect(results.length).toBe(had + 1);
        }
      };
      boom = true;
      await ticks(TICK_FAILURE_LIMIT - 1);
      boom = false;
      await ticks(1);
      boom = true;
      await ticks(TICK_FAILURE_LIMIT - 1);
      expect(results.filter((ok) => !ok)).toHaveLength(2 * (TICK_FAILURE_LIMIT - 1));
      await Bun.sleep(20);
      expect(exits).toEqual([]);
      // Unsaved in memory: only the exit's save can write it.
      const bo = g.world.players.get(l.characterId);
      if (!bo) {
        throw new Error("Bo is not online");
      }
      bo.char.gold = 4321;
      await ticks(1);
      for (let w = 0; w < 400 && exits.length === 0; w++) {
        await Bun.sleep(1);
      }
      expect(TICK_FAILURE_LIMIT).toBe(20);
      expect(exits).toEqual([1]);
      expect(errors).toHaveBeenCalledWith("20 ticks in a row failed: saving and exiting");
      // The exit saved first; the database was closed after.
      const db = openDatabase(dbPath);
      expect(
        db
          .query<{ gold: number }, [string]>("SELECT gold FROM characters WHERE id = ?")
          .get(l.characterId)?.gold,
      ).toBe(4321);
      db.close();
    } finally {
      boom = false;
      errors.mockRestore();
      await server.stop();
    }
  });
});

describe("Cauldrons get unique ids", () => {
  test("SSO: a crafted Cauldron enters the bag with a minted id; a second gets a new one", () => {
    // No shipped recipe yields a Cauldron, so the job names one: the completion mints for it as it
    // does for a built Crate.
    const map = testMap("x1000y992");
    const s = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 6);
    s.join(a);
    const room = s.world.rooms.get(map.name) as Room;
    const ctx = { world: s.world, rng: rngByN(), stepLength: 16 };
    const brew = (now: number) => {
      a.char.bag[0] = { item: "Potion Bottle", qty: 1 };
      a.char.bag[1] = { item: "Red Crystals", qty: 1 };
      a.craft.timers.Mix = {
        counter: 1,
        job: { kind: "Mix", bottle: "Potion Bottle", crystal: "Red Crystals", potion: "Cauldron" },
      };
      craftStep(room, a, ctx, now);
    };
    brew(5_000);
    const first = a.char.bag.find((l) => l?.item.startsWith("Cauldron"))?.item;
    expect(first).toBe("Cauldron#5000");
    a.char.bag[0] = null;
    a.char.bag[1] = null;
    a.char.bag[2] = null;
    brew(5_000); // the same clock: still a new id
    const ids = a.char.bag.filter((l) => l?.item.startsWith("Cauldron")).map((l) => l?.item);
    expect(ids).toEqual(["Cauldron#5001"]);
    expect(s.world.lastContainerId).toBe(5001);
  });
});

describe("Guild vault access is checked at each take", () => {
  /** A has `name` open from the bag (Storage), then frees the keys as a forged client could. */
  function opened(name: string) {
    const map = testMap("x1000y992");
    const s = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    s.join(a);
    s.join(b);
    a.facing = "E";
    s.world.containers.set(name, ["Gold Crown", "Pie"]);
    a.char.bag[0] = { item: name, qty: 1 };
    storageIntent(s.world, a, 1);
    expect(a.container).toMatchObject({ name, carried: true });
    boardCloseIntent(a); // a board close with no board open frees the key lock
    const room = s.world.rooms.get(map.name) as Room;
    const ctx: ItemCtx = { world: s.world, rng: rngByN(), now: 0 };
    return { ...s, map, a, b, room, ctx };
  }

  test("SSO: a carried Cabinet or Crate given away: the giver's open window takes nothing and closes", () => {
    for (const name of ["Cabinet#9", "Crate#11"]) {
      const c = opened(name);
      giveIntent(c.ctx, c.room, c.a, 1);
      expect(c.a.char.bag[0]).toBeNull();
      const w = withdrawContainer(c.world, c.a, 1, c.ctx.rng);
      expect(w.map((o) => o.msg)).toEqual([{ t: "vault", items: [], open: false, closed: true }]);
      expect(c.a.container).toBeNull();
      expect(c.a.char.bag.every((l) => l === null)).toBe(true);
      expect(c.world.containers.get(name)).toEqual(["Gold Crown", "Pie"]);
      // The receiver now holds it and may use it.
      c.run(60);
      expect(c.b.char.bag[0]).toEqual({ item: name, qty: 1 });
      storageIntent(c.world, c.b, 1);
      withdrawContainer(c.world, c.b, 1, c.ctx.rng);
      expect(c.b.char.bag[1]).toEqual({ item: "Gold Crown", qty: 1 });
    }
  });
});
