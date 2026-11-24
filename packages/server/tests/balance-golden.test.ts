/**
 * Issue #19, stage 0: the safety net for moving the balance numbers out of code. Every value the
 * plan moves is read here the way the game reads it (a constant, a setting's default, or a formula
 * probed with a recording random source), and the result must equal the golden recorded before
 * anything moved: `fixtures/balance-golden.json`. Each stage that moves a group must leave Classic
 * reading exactly these numbers.
 *
 * Write the golden afresh with `BALANCE_GOLDEN=write bun test tests/balance-golden.test.ts`, only
 * for a deliberate change to Classic's numbers, then `bunx biome format --write` the file.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MonsterFlags } from "@secondstaronline/data";
import {
  boardingHull,
  CAST_DELAY,
  cannonDamage,
  cannonReloadFrames,
  content,
  deathHunger,
  deathPauseFrames,
  deathVitals,
  type Fighter,
  FLICKER_FRAMES,
  hullHitDamage,
  hullMax,
  hungerTick,
  meleeDamageVsMonster,
  monsterHitsPlayer,
  NO_EQUIPMENT,
  NO_FACTION,
  type PlayerSpellBranch,
  playerSpellAmount,
  pvpHit,
  REST_REGEN,
  type Rng,
  randomAndDefense,
  regenTarget,
  regenTick,
  spellHitOnMonster,
  stuffedHunger,
  swingCooldowns,
  tileLoc,
  type Vitals,
} from "@secondstaronline/shared";

import { defaultSettings } from "../src/settings.ts";
import { GIVE_GRAB_FRAMES } from "../src/systems/inventory/items.ts";
import { monsterAttack } from "../src/systems/monsters/attack.ts";
import { PIG_GRAB_FRAMES } from "../src/systems/monsters/npc.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { species } from "../src/systems/monsters/slots.ts";
import type { MoveCtx } from "../src/systems/movement/movement.ts";
import { rollPushes } from "../src/systems/movement/push.ts";
import { KILL_CREDIT_TICKS } from "../src/systems/progression/vitals.ts";
import { castIntent, swingFireballs } from "../src/systems/spells/cast.ts";
import { argonsFist } from "../src/systems/spells/collide.ts";
import { NPC_SPELL_BLOCK_FRAMES } from "../src/systems/spells/fx.ts";
import type { Player, Room } from "../src/systems/world/world.ts";
import { ARCHIVE_NPCS, player, rngByN, setup, testMap } from "./helpers/sim.ts";

const GOLDEN = join(import.meta.dir, "fixtures", "balance-golden.json");

/** A random source that always rolls `at` (1 or each draw's n) and records each draw's n. */
function recorder(at: "low" | "high"): Rng & { draws: number[] } {
  const draws: number[] = [];
  return {
    draws,
    random(n: number) {
      draws.push(n);
      return at === "low" ? 1 : n;
    },
  };
}

/** An amount probed low and high: the results and the draws it makes. */
function probe(fn: (rng: Rng) => unknown): { low: unknown; high: unknown; draws: number[] } {
  const lo = recorder("low");
  const hi = recorder("high");
  return { low: fn(lo), high: fn(hi), draws: lo.draws };
}

const BRANCHES: readonly PlayerSpellBranch[] = [
  "Arrows",
  "crush",
  "firebolt",
  "Splash",
  "meteor",
  "Fireball",
  "Bolt",
  "wind wave",
  "major heal",
  "minor heal",
];

const MEMBERS = [
  "Blue Arrows",
  "minor heal-3",
  "major heal-3",
  "meteor-13",
  "BoltL-1",
  "Dispel Illusions-8",
  "splash-18",
  "crush-18",
  "Firebolt-12",
  "FireballL-1",
  "Wind waveL-1",
];

const FLAGS: Record<string, MonsterFlags> = {
  plain: {},
  undead: { hurtByHealing: true },
  dispellable: { dispellable: true },
  healed: { healedBy: ["Splash", "Crush", "Meteor", "Bolt", "Firebolt", "Fireball", "Wind Wave"] },
  resists: { resists: ["Splash", "Crush", "Meteor", "Bolt", "Firebolt", "Fireball", "Wind Wave"] },
};

const vitals = (hp: number, sp: number): Vitals => ({
  level: 1,
  hp,
  hpMax: 50,
  sp,
  spMax: 50,
  exp: 0,
  expNeeded: 100,
});

/** A fighter with no gear, every skill at `skill`. */
const fighter = (skill: number): Fighter => ({
  level: 1,
  str: 10,
  sta: 10,
  int: 10,
  wis: 10,
  skills: Array.from({ length: 40 }, () => skill),
  equip: NO_EQUIPMENT,
  faction: NO_FACTION,
  attackBonus: 0,
  wanted: false,
});

/** A map with Ann (and Bob beside her), for the probes the game runs on a live player. */
function scene(rng: Rng = rngByN()) {
  const map = testMap("x1000y992");
  const { world, join, run } = setup([map], undefined, rng);
  const a = player("Ann", map, 6, 6);
  const b = player("Bob", map, 6, 5);
  for (const p of [a, b]) {
    p.flicker = 0;
    p.char.vitals = { ...p.char.vitals, sp: 200, spMax: 200, hp: 20, hpMax: 40 };
  }
  join(a);
  join(b);
  const room = world.rooms.get(map.name) as Room;
  return { map, room, a, b, run, rng };
}

const CRYSTALS = ["Blue", "Green", "Purple", "Red", "White", "Yellow"];

/** Ann casts `spell` on herself once (every crystal in her bag), then the FX runs out. */
function castOnSelf(spell: string, before: (p: Player) => void = () => {}): Player {
  const { a, room, run, rng } = scene();
  a.spell.book = [spell];
  CRYSTALS.forEach((c, i) => {
    a.char.bag[i] = { item: `${c} Crystal`, qty: 10 };
  });
  before(a);
  const me = tileLoc(6, 6);
  castIntent(room, a, spell, me.h, me.v, { rng });
  run(14);
  return a;
}

/** The free fireballs' powers and draws, swung with `weapon`. */
function freeFireballs(weapon: string, fireSword: boolean, at: "low" | "high") {
  const rng = recorder(at);
  const { a, room } = scene();
  a.char.equip = { ...a.char.equip, weapon };
  a.spell.fireSword = fireSword ? 100 : 0;
  swingFireballs(room, a, { rng });
  return { powers: room.fxQueue.map((q) => q.power), draws: rng.draws };
}

/** Every value the plan moves, read as the game reads it. */
function balanceNow(): Record<string, unknown> {
  const P = 7;
  const bare = { equip: NO_EQUIPMENT, magicShield: false };
  const settings = defaultSettings();
  const regen = (hunger: number) => {
    const v = vitals(10, 10);
    regenTick(148, 149, hunger, v);
    return [v.hp, v.sp];
  };
  return {
    spellsOnPlayers: Object.fromEntries(
      BRANCHES.map((b) => [b, probe((r) => playerSpellAmount(b, P, bare, r))]),
    ),
    // Arrows against a Defense at or above the power: the `< 1 → random(2)` floor.
    arrowsFloor: [7, 9].map((defense) =>
      probe((r) => spellHitOnMonster("Blue Arrows", {}, defense, P, r)),
    ),
    spellsOnMonsters: Object.fromEntries(
      Object.entries(FLAGS).map(([kind, flags]) => [
        kind,
        Object.fromEntries(
          MEMBERS.map((m) => [m, probe((r) => spellHitOnMonster(m, flags, 3, P, r))]),
        ),
      ]),
    ),
    buffs: {
      stoneSkinBonus: castOnSelf("Stone Skin").defenseBonus,
      // A Purple Potion's Argon's Fist, on a player with no counter running.
      argonFrames: (() => {
        const { a } = scene();
        a.timers.attackCounter = 0;
        argonsFist(a);
        return a.timers.attackCounter;
      })(),
      // Each buff cast once, as the game casts it (the caster's power from the spell's table).
      magicShield: castOnSelf("Magic Shield").spell.magicDef,
      stoneSkin: castOnSelf("Stone Skin").spell.defenseCounter,
      argonsFist: castOnSelf("Argon's Fist").timers.attackCounter,
      fireSword: castOnSelf("Firesword", (p) => {
        p.char.equip = { ...p.char.equip, weapon: "Short Sword" };
      }).spell.fireSword,
      diminishHunger: [1000, 34_999, 35_000].map(
        (h) =>
          castOnSelf("Diminish Hunger", (p) => {
            p.char.hunger = h;
          }).char.hunger,
      ),
      // Hold on Bob beside her (it never holds its caster): P·8, counting down from the frame it
      // landed, read when the FX has run out.
      hold: (() => {
        const { a, b, room, run, rng } = scene();
        a.spell.book = ["Hold"];
        CRYSTALS.forEach((c, i) => {
          a.char.bag[i] = { item: `${c} Crystal`, qty: 10 };
        });
        const at = tileLoc(6, 5);
        castIntent(room, a, "Hold", at.h, at.v, { rng });
        run(4);
        return b.spell.hold;
      })(),
      morph: (() => {
        const a = castOnSelf("Morph");
        return { counter: a.spell.morph, body: a.spell.body };
      })(),
    },
    castFallbacks: {
      fireStaff: ["low", "high"].map((at) => freeFireballs("Fire Staff", false, at as "low")),
      fireSword: ["low", "high"].map((at) => freeFireballs("Short Sword", true, at as "low")),
    },
    combatRolls: {
      // Melee against a monster: power less Defense, `< 1 → random(3)`.
      meleeFloor: [0, 1, 5].map((power) =>
        probe((r) => meleeDamageVsMonster(power, { name: "Slime", defense: 1 }, "", r)),
      ),
      // `+ random(3)`, the defense bonus, `< 2 → random(3)`.
      pvpFloor: [0, 1, 5].map((power) => probe((r) => randomAndDefense(power, 0, r))),
      // The parry/block ladders: the base roll, and the thresholds' rolls, at a few skills.
      monsterParry: [0, 10, 11, 20, 21, 97].map((skill) =>
        probe((r) => monsterHitsPlayer(10, fighter(skill), 0, r)),
      ),
      pvpParry: [0, 10, 11, 20, 21, 97].map((skill) =>
        probe((r) => pvpHit(10, fighter(skill), "", 0, r)),
      ),
      // A monster's melee roll (1 in 10) and a push's (1 in 25): the draws each makes.
      monsterMelee: (() => {
        const { map, a } = scene();
        const s = map.slots[0] as MonsterSlot;
        s.species = "Slime";
        s.live = {
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
        const rng = recorder("high");
        monsterAttack(map, s, a, { rng, npcs: ARCHIVE_NPCS, invulnerable: () => false });
        return rng.draws;
      })(),
      push: (() => {
        const { room, a } = scene();
        const rng = recorder("high");
        rollPushes(room, a, 6, 5, "U", { rng } as unknown as MoveCtx);
        return rng.draws;
      })(),
      // House rest (already content: houses.restRegen), 1 in 10 below row 11.
      houseRest: REST_REGEN,
    },
    regen: {
      target: regenTarget(0),
      regenAt501: regen(501),
      regenAt500: regen(500),
      regenAt50: regen(50),
      starveAt49: regen(49),
    },
    hunger: {
      tick: probe((r) => hungerTick(100, false, r)),
      stuffed: stuffedHunger(),
      deathHunger: deathHunger(),
    },
    death: {
      vitals: (() => {
        const v = vitals(30, 30);
        deathVitals(v);
        return [v.hp, v.sp];
      })(),
      pauseFrames: deathPauseFrames(),
    },
    timings: {
      flicker: FLICKER_FRAMES,
      castDelay: CAST_DELAY,
      swing: swingCooldowns(NO_EQUIPMENT, []),
      killCredit: KILL_CREDIT_TICKS,
      pigGrab: PIG_GRAB_FRAMES,
      giveGrab: GIVE_GRAB_FRAMES,
      npcSpellBlock: NPC_SPELL_BLOCK_FRAMES,
    },
    vehicles: {
      hulls: {
        Boat: hullMax("Boat"),
        Airship: hullMax("Airship"),
        Battleship: hullMax("Battleship"),
      },
      hullHit: hullHitDamage(),
      repairAfterThreeMinutes: boardingHull({ hull: 10, parkedAt: 0 }, 100, 3 * 60_000),
      cannon: probe((r) => cannonDamage(r)),
      cannonReload: cannonReloadFrames(),
    },
    drops: {
      deathDrops: settings.deathDrops,
      deathDropKind: settings.deathDropKind,
      deathDropGoldCap: settings.deathDropGoldCap,
      deathDropMinLevel: settings.deathDropMinLevel,
      lootDecay: settings.lootDecay,
    },
  };
}

describe("issue #19: Classic's balance numbers", () => {
  test("every value moved out of code still reads as 1.6's (the golden)", () => {
    const now = JSON.parse(JSON.stringify(balanceNow()));
    if (process.env.BALANCE_GOLDEN === "write") {
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
    }
    expect(now).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });

  test("Classic's balance rows are the engine's defaults", () => {
    expect(content().balance.hulls.map((h) => [h.vehicle, h.hull])).toEqual([
      ["Boat", 60],
      ["Airship", 80],
      ["Battleship", 150],
    ]);
  });
});
