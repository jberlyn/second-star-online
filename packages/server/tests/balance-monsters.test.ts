/**
 * The Balance page's Monsters card (issue #31 stage 1): the monsters' global rolls (the move and
 * spawn ladders by players on the map, a walk's steps, each slot's spawn chance, a faction member's
 * slot pick and an NPC's spawn chance) play live from the content store; every value is bounded so
 * a roll is always drawn as it was; the generic stand-in is shown from its own monsters row.
 *
 * Classic's numbers stay 1.6's: monster-golden.test.ts.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classicData } from "@secondstaronline/data/classic";
import { balanceDataSchema } from "@secondstaronline/data/schema";
import {
  BALANCE_DEFAULTS,
  type BalanceRowView,
  buildContentStore,
  type ContentData,
  content,
  installContent,
  type Rng,
} from "@secondstaronline/shared";

import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { authorPath, moveLadder, moverPass } from "../src/systems/monsters/ai.ts";
import { spawnLadder, spawnPass } from "../src/systems/monsters/spawn.ts";
import { manualClock } from "./helpers/manual-clock.ts";
import { ARCHIVE_NPCS, player, testMap } from "./helpers/sim.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

function withMonsters(edit: Partial<(typeof BALANCE_DEFAULTS)["monsters"]>): void {
  const d = structuredClone(classicData) as ContentData;
  const b = d.balance as NonNullable<ContentData["balance"]>;
  b.monsters = { ...BALANCE_DEFAULTS.monsters, ...edit };
  balanceDataSchema.parse(b);
  installContent(buildContentStore(d));
}

afterEach(() => {
  installContent(buildContentStore(classicData as ContentData));
});

function recorder(): Rng & { draws: number[] } {
  const draws: number[] = [];
  return {
    draws,
    random(n) {
      draws.push(n);
      return n >= 1 ? 1 : 0;
    },
  };
}

/**
 * A pass over a faction map (its member takes slot 1) with an NPC (Trimble) and a monster (Slime),
 * every roll 1.
 */
function pass() {
  const map = testMap("x1");
  map.flags.fctSpwn = "warrior";
  map.slots.forEach((s, i) => {
    s.species = [null, "Trimble", "Slime", null][i] ?? null;
  });
  const rng = recorder();
  const spawned = spawnPass(map, { rng, players: 2, minute: 30 });
  return { draws: rng.draws, spawned: spawned.map((s) => s.live?.name) };
}

describe("the monsters' rolls (#31 stage 1)", () => {
  test("Classic's are 1.6's, and the engine's defaults", () => {
    expect(content().balance.monsters).toEqual(BALANCE_DEFAULTS.monsters);
    expect(classicData.balance?.monsters).toEqual(BALANCE_DEFAULTS.monsters);
    expect([1, 2, 8, 9].map(moveLadder)).toEqual([30, 50, 600, 600]);
    expect([1, 7, 8].map(spawnLadder)).toEqual([80, 1300, 1300]);
    // The faction swap's random(35), the gate's 120 (2 players), then for each slot its tile, its
    // random(5), Trimble's random(60) and the facing's random(4).
    expect(pass().draws).toEqual([35, 120, 17, 12, 5, 4, 17, 12, 5, 60, 4, 17, 12, 5, 4]);
    expect(pass().spawned).toEqual(["Warrior Faction Member", "Trimble", "Slime"]);
  });

  test("each plays live: the ladders, the walk, the slot chance, the faction slot and the NPC roll", () => {
    withMonsters({
      moveLadder: [7, 8, 9, 10, 11, 12, 13, 14],
      walkStepsRandomN: 3,
      spawnLadder: [21, 22, 23, 24, 25, 26, 27],
      slotOneIn: 2,
      factionSlotRandomN: 4,
      npcSpawn: { randomN: 9, passAtMost: 9 },
    });
    expect([1, 2, 8, 12].map(moveLadder)).toEqual([7, 8, 14, 14]);
    expect([1, 2, 7, 12].map(spawnLadder)).toEqual([21, 22, 27, 27]);
    const p = pass();
    expect(p.draws).toEqual([4, 22, 17, 12, 2, 4, 17, 12, 2, 9, 4, 17, 12, 2, 4]);
    expect(p.spawned).toEqual(["Warrior Faction Member", "Trimble", "Slime"]);
    const map = testMap("x2");
    const rng = recorder();
    authorPath(
      ARCHIVE_NPCS,
      {
        name: "Slime",
        hp: 1,
        x: 5,
        y: 5,
        facing: "S",
        anim: 0,
        fromX: 5,
        fromY: 5,
        queue: [],
        hitCountb: 0,
      },
      player("Ann", map, 3, 3),
      rng,
    );
    expect(rng.draws[0]).toBe(3);
  });

  test("an NPC whose roll passes at 0 never spawns; a monster beside it still does", () => {
    withMonsters({ npcSpawn: { randomN: 60, passAtMost: 0 } });
    expect(pass().spawned).toEqual(["Warrior Faction Member", "Slime"]);
  });

  test("the edges: a chance of 1 in 1 and a ladder of 1s draw as before and always pass", () => {
    withMonsters({
      moveLadder: [4, 4, 4, 4, 4, 4, 4, 4],
      spawnLadder: [1, 1, 1, 1, 1, 1, 1],
      slotOneIn: 1,
      factionSlotRandomN: 4,
      walkStepsRandomN: 1,
      npcSpawn: { randomN: 1, passAtMost: 1 },
    });
    expect(pass().spawned).toEqual(["Warrior Faction Member", "Trimble", "Slime"]);
  });

  test("a move pick of 4, the least allowed, can still pick the roster's last slot", () => {
    withMonsters({ moveLadder: [4, 4, 4, 4, 4, 4, 4, 4] });
    const map = testMap("x3");
    const author = player("Ann", map, 3, 3);
    for (const want of [1, 4]) {
      map.slots.forEach((s, i) => {
        s.species = "Slime";
        s.pause = 0;
        s.live = {
          name: "Slime",
          hp: 1,
          x: 5 + i,
          y: 5,
          facing: "S",
          anim: 0,
          fromX: 5 + i,
          fromY: 5,
          queue: [],
          hitCountb: 0,
        };
      });
      let first = true;
      const rng: Rng = {
        random(n) {
          const r = first ? want : 1;
          first = false;
          return n >= 1 ? Math.min(r, n) : 0;
        },
      };
      moverPass(ARCHIVE_NPCS, map, author, 1, rng, [author]);
      // The picked slot (and only it) takes a pause: 30 for the pick, 90 once it steps.
      expect(map.slots.map((s) => s.pause > 0)).toEqual([1, 2, 3, 4].map((k) => k === want));
    }
  });

  test("refuses a roll of 0, a ladder of the wrong length, and an NPC chance above its roll", () => {
    const ok = (m: unknown) => balanceDataSchema.safeParse({ monsters: m }).success;
    const d = BALANCE_DEFAULTS.monsters;
    expect(ok(d)).toBe(true);
    expect(ok({ ...d, moveLadder: [0, 50, 70, 100, 200, 300, 400, 600] })).toBe(false);
    // Below 4 the later roster slots could never be picked to move.
    expect(ok({ ...d, moveLadder: [3, 50, 70, 100, 200, 300, 400, 600] })).toBe(false);
    expect(ok({ ...d, moveLadder: [4, 50, 70, 100, 200, 300, 400, 600] })).toBe(true);
    expect(ok({ ...d, moveLadder: [30, 50, 70] })).toBe(false);
    expect(ok({ ...d, spawnLadder: [...d.spawnLadder, 1500] })).toBe(false);
    expect(ok({ ...d, walkStepsRandomN: 0 })).toBe(false);
    expect(ok({ ...d, slotOneIn: 0 })).toBe(false);
    expect(ok({ ...d, factionSlotRandomN: 0 })).toBe(false);
    // Below 4 the member would always take a slot (1 never spawns its own species) and never the
    // later ones.
    expect(ok({ ...d, factionSlotRandomN: 3 })).toBe(false);
    expect(ok({ ...d, factionSlotRandomN: 4 })).toBe(true);
    expect(ok({ ...d, npcSpawn: { randomN: 0, passAtMost: 0 } })).toBe(false);
    expect(ok({ ...d, npcSpawn: { randomN: 60, passAtMost: 61 } })).toBe(false);
  });
});

describe("the Balance page's Monsters card", () => {
  const dirs: string[] = [];
  let logSpy: ReturnType<typeof spyOn> | null = null;
  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy?.mockRestore();
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function start(pack?: "minimal"): RunningServer {
    const dir = mkdtempSync(join(tmpdir(), "sso-balance-monsters-"));
    dirs.push(dir);
    const clientDir = join(dir, "client");
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
    const server = startServer({
      dbPath: join(dir, "world.sqlite"),
      port: 0,
      development: false,
      clientDir,
      clock: manualClock(),
      autoTick: false,
      isoNow: () => "2026-11-25T00:00:00.000Z",
      rng: { random: (n) => (n >= 1 ? 1 : 0) },
      onLag: () => {},
      ...(pack ? { content: pack } : {}),
    });
    server.db
      .query(
        "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
      )
      .run(ADMIN.accountId, ADMIN.name.toLowerCase());
    return server;
  }

  const card = (s: RunningServer) => {
    const g = s.content.balanceView().groups.find((x) => x.id === "monsters");
    if (!g) {
      throw new Error("no Monsters card");
    }
    return g;
  };
  const row = (s: RunningServer): BalanceRowView => card(s).rows[0] as BalanceRowView;

  test("one row with every roll, the generic stand-in shown from its own row, and a publish plays at once", async () => {
    const server = start();
    try {
      const r = row(server);
      expect(r.part).toBe("monsters");
      expect(r.fields.map((f) => f.path.join("."))).toEqual([
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `moveLadder.${i}`),
        "walkStepsRandomN",
        ...[0, 1, 2, 3, 4, 5, 6].map((i) => `spawnLadder.${i}`),
        "slotOneIn",
        "factionSlotRandomN",
        "npcSpawn.randomN",
        "npcSpawn.passAtMost",
      ]);
      expect(r.fields.every((f) => f.min >= 0 && f.max > f.min)).toBe(true);
      expect(r).toMatchObject({ engine: BALANCE_DEFAULTS.monsters, edited: false });
      expect(card(server).elsewhere).toEqual([
        {
          label: expect.stringContaining("Generic stand-in"),
          row: { dataset: "monsters", part: "generic", key: null },
          // Its `hp` is never read: such a name starts with 1 HP.
          now: "body 200, defense 13 (it starts with 1 HP)",
        },
      ]);
      const data = {
        ...BALANCE_DEFAULTS.monsters,
        moveLadder: [5, 50, 70, 100, 200, 300, 400, 600],
      };
      expect(
        server.content.draftBalance(ADMIN, {
          part: "monsters",
          key: null,
          op: "set",
          data,
          expect: r.fingerprint,
        }).ok,
      ).toBe(true);
      expect(moveLadder(1)).toBe(30);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "Busier").ok).toBe(true);
      expect(moveLadder(1)).toBe(5);
      expect(row(server).edited).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("a refusal names the card's field; a stale save is refused; Minimal plays the defaults", async () => {
    const server = start();
    try {
      const r = row(server);
      const bad = server.content.draftBalance(ADMIN, {
        part: "monsters",
        key: null,
        op: "set",
        data: { ...BALANCE_DEFAULTS.monsters, npcSpawn: { randomN: 60, passAtMost: 61 } },
        expect: r.fingerprint,
      });
      expect(bad).toEqual({
        ok: false,
        error: expect.any(String),
        problems: [
          {
            where: "An NPC spawns when that roll is at most",
            message: expect.stringContaining(
              '"An NPC spawns when that roll is at most" must be at most',
            ),
          },
        ],
      });
      const low = server.content.draftBalance(ADMIN, {
        part: "monsters",
        key: null,
        op: "set",
        data: { ...BALANCE_DEFAULTS.monsters, moveLadder: [3, 50, 70, 100, 200, 300, 400, 600] },
        expect: r.fingerprint,
      });
      expect(low.ok).toBe(false);
      expect(!low.ok && low.problems?.[0]?.where).toBe("Move roll with 1 player: 1 to");
      expect(r.fields.find((f) => f.path.join(".") === "moveLadder.0")?.min).toBe(4);
      expect(r.fields.find((f) => f.path.join(".") === "factionSlotRandomN")?.min).toBe(4);
      // One error for a value of 0, not two contradicting ones.
      const zero = server.content.draftBalance(ADMIN, {
        part: "monsters",
        key: null,
        op: "set",
        data: { ...BALANCE_DEFAULTS.monsters, moveLadder: [0, 50, 70, 100, 200, 300, 400, 600] },
        expect: r.fingerprint,
      });
      expect(!zero.ok && zero.problems?.length).toBe(1);
      expect(
        server.content.draftBalance(ADMIN, {
          part: "monsters",
          key: null,
          op: "set",
          data: { ...BALANCE_DEFAULTS.monsters, slotOneIn: 3 },
          expect: "stale",
        }).ok,
      ).toBe(false);
    } finally {
      await server.stop();
    }
    const minimal = start("minimal");
    try {
      expect(row(minimal)).toMatchObject({ pack: null, engine: BALANCE_DEFAULTS.monsters });
      expect(content().balance.monsters).toEqual(BALANCE_DEFAULTS.monsters);
    } finally {
      await minimal.stop();
    }
  });
});
