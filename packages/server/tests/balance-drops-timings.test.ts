/**
 * The Balance page's death drops and loot, timings and combat rolls (issue #19, stages 4 and 5):
 * each row plays live from the content store; the death-drop and loot settings an operator changed
 * move out of Server Settings into a published, logged and undoable `drops` row once; every value
 * is bounded, with the edges (a floor of 1, a 1-in-1 chance) safe to play.
 *
 * Classic's numbers stay 1.6's (and SSO's settings defaults for the drops): balance-golden.test.ts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classicData } from "@secondstaronline/data/classic";
import { balanceDataSchema } from "@secondstaronline/data/schema";
import {
  BALANCE_DEFAULTS,
  buildContentStore,
  type ContentData,
  content,
  installContent,
  meleeDamageVsMonster,
  NO_EQUIPMENT,
  NO_FACTION,
  pvpHit,
  type Rng,
  randomAndDefense,
  skillIndex,
  swingCooldowns,
  tileLoc,
} from "@secondstaronline/shared";

import { MOVE_SUMMARY, moveDropSettings } from "../src/content/moved-settings.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { defaultSettings, settingPages } from "../src/settings.ts";
import { pollAttack, setAttackHeld } from "../src/systems/combat/melee.ts";
import { giveGrabFrames } from "../src/systems/inventory/items.ts";
import { monsterAttack } from "../src/systems/monsters/attack.ts";
import { pigGrabFrames } from "../src/systems/monsters/npc.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import type { MoveCtx } from "../src/systems/movement/movement.ts";
import { rollPushes } from "../src/systems/movement/push.ts";
import { killCreditFrames } from "../src/systems/progression/vitals.ts";
import { castIntent } from "../src/systems/spells/cast.ts";
import { npcSpellBlockFrames } from "../src/systems/spells/fx.ts";
import type { Player, Room } from "../src/systems/world/world.ts";
import { manualClock } from "./helpers/manual-clock.ts";
import { ARCHIVE_NPCS, player, rngByN, setup, testMap } from "./helpers/sim.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** Classic with its balance changed by `edit`, installed (only rows the server would accept). */
function withBalance(edit: (b: NonNullable<ContentData["balance"]>) => void): void {
  const d = structuredClone(classicData) as ContentData;
  edit(d.balance as NonNullable<ContentData["balance"]>);
  balanceDataSchema.parse(d.balance);
  installContent(buildContentStore(d));
}

afterEach(() => {
  installContent(buildContentStore(classicData as ContentData));
});

/** Records each draw's n and rolls `at` (1, or each draw's n). */
function recorder(at: "low" | "high"): Rng & { draws: number[] } {
  const draws: number[] = [];
  return {
    draws,
    random(n) {
      draws.push(n);
      return at === "low" ? 1 : n;
    },
  };
}

function scene(now?: () => number, rng: Rng = rngByN()) {
  const map = testMap("x1000y992", [[5, 5]]);
  const s = setup([map], undefined, rng, now);
  const join = (name: string, x: number, y: number) => {
    const p = player(name, map, x, y);
    p.flicker = 0;
    p.char.vitals = { ...p.char.vitals, sp: 200, spMax: 200, hp: 100, hpMax: 100 };
    s.join(p);
    return p;
  };
  const room = () => s.world.rooms.get(map.name) as Room;
  return { ...s, rng, map, join, room };
}

const give = (p: Player, item: string, qty: number) => {
  const i = p.char.bag.indexOf(null);
  p.char.bag[i] = { item, qty };
};

describe("death drops and loot play from the balance row `drops`", () => {
  test("Drops on death: Everyone drops a dead player's item; Off keeps even a wanted one's", () => {
    withBalance((b) => {
      b.drops = { ...BALANCE_DEFAULTS.drops, who: "everyone", kind: "items" };
    });
    const s = scene();
    const a = s.join("Ann", 6, 6);
    give(a, "Apple", 1);
    a.char.vitals.hp = 0;
    s.run(1);
    expect(s.map.ground.filter((g) => g.x === 6 && g.y === 6).map((g) => g.item)).toEqual([
      "Apple",
    ]);
    withBalance((b) => {
      b.drops = { ...BALANCE_DEFAULTS.drops, who: "off" };
    });
    const w = s.join("Wes", 9, 9);
    w.char.wanted = true;
    give(w, "Knife", 1);
    w.char.vitals.hp = 0;
    s.run(1);
    expect(s.map.ground.some((g) => g.x === 9 && g.y === 9)).toBe(false);
  });

  test("Monster loot lasts: a felled tree's logs decay after the row's seconds", () => {
    withBalance((b) => {
      b.drops = { ...BALANCE_DEFAULTS.drops, lootDecaySeconds: 120 };
    });
    const now = 5_000_000;
    // The rolls gather.test.ts fells a tree with: hunger's random(3) and the fall's random(12).
    const s = scene(() => now, rngByN({ 3: Array(4000).fill(1), 12: [1] }));
    const a = s.join("Ann", 5, 6);
    a.char.equip.weapon = "Axe";
    a.char.skills[skillIndex("Lumberjacking")] = 5;
    setAttackHeld(a, true);
    for (let i = 0; i < 2000 && !s.map.ground.some((g) => g.item === "Logs"); i++) {
      s.run(1);
    }
    const logs = s.map.ground.find((g) => g.item === "Logs");
    expect(logs?.kind).toBe("loot");
    expect(logs?.expiresAt).toBe(now + 120_000);
  });
});

describe("timings play from the balance row `timings`", () => {
  test("a cast waits the cast delay, and its hit flickers the victim for the flicker", () => {
    withBalance((b) => {
      b.timings = { ...BALANCE_DEFAULTS.timings, castDelayFrames: 33, flickerFrames: 7 };
    });
    const s = scene();
    s.map.flags.canPvp = "X";
    const a = s.join("Ann", 6, 6);
    const b = s.join("Bob", 9, 6);
    a.spell.book = ["Firebolt"];
    give(a, "Red Crystal", 40);
    const t = tileLoc(9, 6);
    castIntent(s.room(), a, "Firebolt", t.h, t.v, { rng: s.rng });
    expect(a.timers.actionDelay).toBe(33);
    let flicker = 0;
    for (let i = 0; i < 30 && flicker === 0; i++) {
      s.run(1);
      flicker = b.flicker;
    }
    // Seen once the tick that hit is over (Classic's 40 would still be near 40).
    expect(flicker).toBeGreaterThan(0);
    expect(flicker).toBeLessThanOrEqual(7);
    expect(b.char.vitals.hp).toBeLessThan(100);
  });

  test("the swing cooldown with no gear, the kill credit, pig, give and monster-spell windows", () => {
    withBalance((b) => {
      b.timings = {
        flickerFrames: 40,
        castDelayFrames: 20,
        swingBaseFrames: 9,
        killCreditFrames: 11,
        pigGrabFrames: 12,
        giveGrabFrames: 13,
        npcSpellBlockFrames: 14,
      };
    });
    expect(swingCooldowns(NO_EQUIPMENT, [])).toEqual({ atDelay: 9, actionDelay: 9 });
    expect([killCreditFrames(), pigGrabFrames(), giveGrabFrames(), npcSpellBlockFrames()]).toEqual([
      11, 12, 13, 14,
    ]);
  });

  test("a death past the kill credit credits no killer", () => {
    withBalance((b) => {
      b.timings = { ...BALANCE_DEFAULTS.timings, killCreditFrames: 3 };
    });
    const s = scene();
    const a = s.join("Ann", 6, 6);
    const b = s.join("Bob", 9, 9);
    b.lastToHitMe = "Ann";
    b.lastToHitId = a.id;
    b.hitAge = 0;
    s.run(5);
    b.char.vitals.hp = 0;
    // The wanted flag waits for the end of the death lock.
    s.run(60);
    expect(a.char.wanted).toBe(false);
    // Within the window, the same death is Ann's murder.
    const c = s.join("Cid", 3, 3);
    c.lastToHitMe = "Ann";
    c.lastToHitId = a.id;
    c.hitAge = 0;
    s.run(2);
    c.char.vitals.hp = 0;
    s.run(60);
    expect(a.char.wanted).toBe(true);
  });
});

describe("combat rolls play from the balance row `combat`", () => {
  test("the floors: melee on a monster and a hit on a player roll below their `below`", () => {
    withBalance((b) => {
      b.combat = {
        ...BALANCE_DEFAULTS.combat,
        meleeFloor: { below: 5, randomN: 7 },
        playerHitFloor: { below: 6, randomN: 9 },
      };
    });
    // 4 less Defense 1 is 3, under 5: random(7) instead.
    const melee = recorder("high");
    expect(meleeDamageVsMonster(4, { name: "Slime", defense: 1 }, "", melee)).toBe(7);
    expect(melee.draws).toEqual([7]);
    // 6 is not under 5: kept.
    expect(meleeDamageVsMonster(7, { name: "Slime", defense: 1 }, "", recorder("high"))).toBe(6);
    // 1 + random(3) at its lowest is 2, under 6: random(9).
    const hit = recorder("low");
    expect(randomAndDefense(1, 0, hit)).toBe(1);
    expect(hit.draws).toEqual([3, 9]);
  });

  test("the parry base roll, against players at skill 0", () => {
    withBalance((b) => {
      b.combat = { ...BALANCE_DEFAULTS.combat, dodgeBaseRandomN: 1 };
    });
    // random(1) is always 1: a parry at skill 0, whatever the hit.
    const f = {
      skills: new Array(40).fill(0),
      equip: NO_EQUIPMENT,
      faction: NO_FACTION,
      defenseBonus: 0,
    };
    const r = pvpHit(10, f as never, "", 0, recorder("high"));
    expect(r.kind).toBe("parry");
  });

  test("a monster's melee chance and a push's chance are their rows' 1 in N", () => {
    withBalance((b) => {
      b.combat = { ...BALANCE_DEFAULTS.combat, monsterMeleeOneIn: 4, pushOneIn: 6 };
    });
    const s = scene();
    const a = s.join("Ann", 6, 6);
    const slot = s.map.slots[0] as MonsterSlot;
    slot.species = "Slime";
    slot.live = {
      name: "Slime",
      hp: species("Slime")?.hp ?? 1,
      x: 6,
      y: 7,
      facing: "N",
      anim: 0,
      fromX: 6,
      fromY: 7,
      queue: [],
      hitCountb: 0,
    };
    const melee = recorder("high");
    monsterAttack(s.map, slot, a, { rng: melee, npcs: ARCHIVE_NPCS, invulnerable: () => false });
    expect(melee.draws[0]).toBe(4);
    const b = s.join("Bob", 6, 5);
    const push = recorder("high");
    rollPushes(s.room(), a, 6, 5, "U", { rng: push } as unknown as MoveCtx);
    expect(push.draws).toEqual([6]);
    expect(b.x).toBe(6);
  });

  test("the edges are safe: a 1-in-1 monster attacks every time, a floor of 1 never deals 0", () => {
    withBalance((b) => {
      b.combat = {
        ...BALANCE_DEFAULTS.combat,
        meleeFloor: { below: 1, randomN: 1 },
        monsterMeleeOneIn: 1,
      };
    });
    expect(meleeDamageVsMonster(0, { name: "Slime", defense: 50 }, "", recorder("low"))).toBe(1);
    expect(content().balance.combat.monsterMeleeOneIn).toBe(1);
  });
});

describe("the limits", () => {
  test("refuses a floor of 0, a swing cooldown of 0, loot under a minute and an unknown pick", () => {
    const base = structuredClone(classicData.balance) as NonNullable<ContentData["balance"]>;
    const bad = [
      { ...base, combat: { ...base.combat, meleeFloor: { below: 0, randomN: 3 } } },
      { ...base, combat: { ...base.combat, monsterMeleeOneIn: 0 } },
      { ...base, timings: { ...base.timings, swingBaseFrames: 0 } },
      // A kill credit of 0 would lose a melee kill, judged 1 frame after it landed.
      { ...base, timings: { ...base.timings, killCreditFrames: 0 } },
      // A cast delay of 0 would let every cast in one frame through, flooding the FX.
      { ...base, timings: { ...base.timings, castDelayFrames: 0 } },
      { ...base, drops: { ...base.drops, lootDecaySeconds: 59 } },
      { ...base, drops: { ...base.drops, who: "sometimes" } },
    ];
    for (const b of bad) {
      expect(balanceDataSchema.safeParse(b).success).toBe(false);
    }
  });

  test("a swing cooldown below the gear's never makes gear slow a ladder (Fishing Pole with the Ring)", () => {
    const pole = { ...NO_EQUIPMENT, weapon: "Fishing Pole" };
    const ringed = { ...pole, ring: "Ring of Quickness" };
    const at = (equip: typeof NO_EQUIPMENT) => swingCooldowns(equip, []).atDelay;
    expect(at(ringed)).toBeLessThan(at(pole));
    withBalance((b) => {
      b.timings = { ...BALANCE_DEFAULTS.timings, swingBaseFrames: 3 };
    });
    expect(at(ringed)).toBeLessThanOrEqual(at(pole));
  });
});

describe("the death-drop and loot settings move to the Balance page", () => {
  let server: RunningServer | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  const start = (settings: Record<string, string>, dbPath = ":memory:") =>
    startServer({
      dbPath,
      port: 0,
      development: false,
      autoTick: false,
      clock: manualClock(),
      prepare: (db) => {
        for (const [key, value] of Object.entries(settings)) {
          db.run("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 'then')", [
            key,
            value,
          ]);
        }
      },
    });

  test("an operator's values become a published drops row, logged and undoable; the settings go", async () => {
    server = await start({
      deathDrops: '"everyone"',
      lootDecay: "600",
      deathDropGoldCap: "50",
      // Never played (outside the old limits): dropped with the rest.
      deathDropMinLevel: "-4",
      chatMaxChars: "100",
    });
    expect(content().balance.drops).toEqual({
      who: "everyone",
      kind: "either",
      goldCap: 50,
      minLevel: 0,
      lootDecaySeconds: 600,
    });
    const db = server.db;
    const keys = db
      .query("SELECT key FROM settings ORDER BY key")
      .all()
      .map((r) => (r as { key: string }).key);
    expect(keys).toContain("chatMaxChars");
    expect(keys.filter((k) => /^deathDrop|^lootDecay$/.test(k))).toEqual([]);
    const log = server.content.history(5);
    expect(log[0]?.summary).toBe(MOVE_SUMMARY);
    expect(log[0]?.actorName).toBe("system");
    const view = server.content.balanceView();
    const drops = view.groups.flatMap((g) => g.rows).find((r) => r.part === "drops");
    expect(drops?.edited).toBe(true);
    // Undone: the pack's (SSO's old defaults) play again.
    const undo = server.content.undo(ADMIN, log[0]?.id as string);
    expect(undo.ok).toBe(true);
    expect(content().balance.drops).toEqual(BALANCE_DEFAULTS.drops);
  });

  test("Server Settings no longer hold them, and its Items page says where they went", () => {
    const keys = Object.keys(defaultSettings());
    for (const k of [
      "deathDrops",
      "deathDropKind",
      "deathDropGoldCap",
      "deathDropMinLevel",
      "lootDecay",
    ]) {
      expect(keys).not.toContain(k);
    }
    expect(settingPages().find((p) => p.id === "items")?.note).toContain("Balance page");
  });

  test("a server that changed none of them gets no publish; one with only bad values loses them", async () => {
    server = await start({});
    expect(server.content.history(5)).toEqual([]);
    await server.stop();
    server = await start({ deathDrops: '"sometimes"' });
    expect(server.content.history(5)).toEqual([]);
    expect(
      server.db.query("SELECT COUNT(*) AS n FROM settings WHERE key = 'deathDrops'").get(),
    ).toEqual({ n: 0 });
    expect(content().balance.drops).toEqual(BALANCE_DEFAULTS.drops);
  });
});

describe("the fatal hit keeps the kill at the edges of the timings", () => {
  /** Ann (and Cid, from the other side) swing at Bob on 1 HP in the same tick. */
  const fight = (timings: Partial<typeof BALANCE_DEFAULTS.timings>, cid: boolean) => {
    withBalance((b) => {
      b.timings = { ...BALANCE_DEFAULTS.timings, ...timings };
    });
    // High rolls: no parry or block, full damage.
    const s = scene(undefined, recorder("high"));
    s.map.flags.canPvp = "X";
    const a = s.join("Ann", 6, 6);
    const b = s.join("Bob", 7, 6);
    const c = cid ? s.join("Cid", 8, 6) : null;
    a.facing = "E";
    b.char.vitals.hp = 1;
    for (const p of c ? [a, c] : [a]) {
      p.timers.canAttack = true;
      setAttackHeld(p, true);
    }
    if (c) {
      c.facing = "W";
    }
    s.run(1);
    for (const p of c ? [a, c] : [a]) {
      setAttackHeld(p, false);
    }
    expect(b.char.vitals.hp).toBe(0);
    expect(b.lastToHitMe).toBe("Ann");
    // The wanted flag waits for the end of the death lock.
    s.run(60);
    return { a, c };
  };

  test("the least kill credit (1 frame) still credits the swing that killed", () => {
    const { a } = fight({ killCreditFrames: 1 }, false);
    expect(a.char.wanted).toBe(true);
  });

  test("a flicker of 0 frames: a second swing in the same tick does not take the kill", () => {
    const { a, c } = fight({ flickerFrames: 0, killCreditFrames: 1 }, true);
    expect(a.char.wanted).toBe(true);
    expect(c?.char.wanted).toBe(false);
  });
});

describe("the move of the death-drop and loot settings, at its edges", () => {
  let server: RunningServer | null = null;
  let dir: string | null = null;
  const original = ContentService.prototype.publishMoved;
  afterEach(async () => {
    ContentService.prototype.publishMoved = original;
    await server?.stop();
    server = null;
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });
  const DROPS = { dataset: "balance", part: "drops", key: null } as const;
  const start = (prepare: (db: RunningServer["db"]) => void = () => {}, dbPath = ":memory:") =>
    startServer({
      dbPath,
      port: 0,
      development: false,
      autoTick: false,
      clock: manualClock(),
      prepare,
    });
  const settings = (db: RunningServer["db"], values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) {
      db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, 'then')", [
        key,
        value,
      ]);
    }
  };
  const moves = (s: RunningServer) =>
    s.content.history(10).filter((p) => p.summary === MOVE_SUMMARY);
  const settingsLeft = (s: RunningServer) =>
    (
      s.db
        .query(
          "SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'deathDrop%' OR key = 'lootDecay'",
        )
        .get() as { n: number }
    ).n;

  test("a gap the published content already had does not hold the move back", async () => {
    server = await start((db) => {
      settings(db, { deathDrops: '"off"' });
      // A published sound whose file is missing: every publish names it until it is fixed.
      db.run(
        "INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at) VALUES ('art', 'sounds', 'gone', 'set', ?, NULL, NULL, 1, 'a1', 'now')",
        [JSON.stringify({ name: "gone", file: "a".repeat(64), format: "wav" })],
      );
    });
    // The gap is real: an ordinary publish over it is refused, naming the sound.
    const hull = { vehicle: "Boat", hull: 61 };
    const boat = { dataset: "balance", part: "hulls", key: "Boat" } as const;
    expect(server.content.draftSet(ADMIN, boat, "set", hull).ok).toBe(true);
    const refused = server.content.publish(ADMIN, server.content.draftRev(), "hull");
    expect(refused.ok).toBe(false);
    expect(content().balance.drops.who).toBe("off");
    expect(moves(server)).toHaveLength(1);
    expect(settingsLeft(server)).toBe(0);
  });

  test("a move that cannot publish keeps the old values playing, and never overrides a later edit", async () => {
    dir = mkdtempSync(join(tmpdir(), "sso-move-"));
    const path = join(dir, "w.sqlite");
    ContentService.prototype.publishMoved = function (this: ContentService, _a, _s, plan) {
      plan(this.store() as unknown as ContentData, []);
      return { ok: false, error: "forced" };
    };
    server = await start((db) => settings(db, { deathDrops: '"off"', lootDecay: "600" }), path);
    // Held in memory, the settings rows kept for the next start.
    expect(content().balance.drops).toMatchObject({ who: "off", lootDecaySeconds: 600 });
    expect(settingsLeft(server)).toBe(2);
    ContentService.prototype.publishMoved = original;
    // The operator then sets the row on the Balance page.
    const row = { ...content().balance.drops, goldCap: 7 };
    expect(server.content.draftSet(ADMIN, DROPS, "set", row).ok).toBe(true);
    expect(server.content.publish(ADMIN, server.content.draftRev(), "drops").ok).toBe(true);
    await server.stop();
    server = await start(() => {}, path);
    // The next start finds the operator's row: the old settings go without a publish.
    expect(settingsLeft(server)).toBe(0);
    expect(moves(server)).toHaveLength(0);
    expect(content().balance.drops).toEqual(row);
  });

  test("the move reads under the lock: a row another server committed wins, and is picked up", async () => {
    server = await start();
    // Another server moved them meanwhile (its row committed), while this one's store is stale.
    const theirs = { ...BALANCE_DEFAULTS.drops, who: "pvp" as const };
    server.db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at) VALUES ('balance', 'drops', '', 'set', ?, NULL, NULL, 99, 'system', 'now')",
      [JSON.stringify(theirs)],
    );
    settings(server.db, { deathDrops: '"everyone"' });
    expect(moveDropSettings(server.db, server.content)).toEqual([]);
    expect(moves(server)).toHaveLength(0);
    expect(settingsLeft(server)).toBe(0);
    expect(server.content.store().balance.drops).toEqual(theirs);
    // Run again: nothing left to move.
    expect(moveDropSettings(server.db, server.content)).toEqual([]);
  });

  test("an open draft of the row is rebased onto the moved values; a field both changed is named", async () => {
    server = await start();
    const draft = { ...BALANCE_DEFAULTS.drops, goldCap: 77, who: "pvp" as const };
    expect(server.content.draftSet(ADMIN, DROPS, "set", draft).ok).toBe(true);
    settings(server.db, { deathDrops: '"off"', lootDecay: "600" });
    const lines = moveDropSettings(server.db, server.content);
    expect(lines[0]).toContain("moved the death-drop and loot settings");
    expect(lines.slice(1)).toEqual([
      "content: the draft also changes balance/drops: who: the draft keeps its value, so publishing it replaces the moved one",
    ]);
    expect(content().balance.drops).toMatchObject({ who: "off", lootDecaySeconds: 600 });
    // The draft's untouched loot decay took the moved value; its own changes stayed.
    const row = server.content.draft().find((d) => d.part === "drops");
    expect(row?.data).toEqual({ ...draft, lootDecaySeconds: 600 });
    // A draft left equal to the moved row is dropped.
    await server.stop();
    server = await start();
    expect(
      server.content.draftSet(ADMIN, DROPS, "set", {
        ...BALANCE_DEFAULTS.drops,
        lootDecaySeconds: 600,
      }).ok,
    ).toBe(true);
    settings(server.db, { lootDecay: "600" });
    moveDropSettings(server.db, server.content);
    expect(server.content.draft().some((d) => d.part === "drops")).toBe(false);
  });

  test("values equal to what plays move nothing: no override, no notice blocking the pack", async () => {
    server = await start((db) =>
      settings(db, {
        deathDrops: '"wanted"',
        lootDecay: String(BALANCE_DEFAULTS.drops.lootDecaySeconds),
      }),
    );
    expect(moves(server)).toHaveLength(0);
    expect(settingsLeft(server)).toBe(0);
    const drops = server.content
      .balanceView()
      .groups.flatMap((g) => g.rows)
      .find((r) => r.part === "drops");
    expect(drops?.edited).toBe(false);
  });
});
