/**
 * The Balance page's spell amounts, buffs, regeneration, hunger and death (issue #19, stages 2 and
 * 3): each row plays live from the content store, a spell row's own `amount` replaces its effect's
 * for that spell's hits only, every value is bounded (with hunger's thresholds in order), and the
 * page edits, publishes and reverts the rows like the vehicle rows (balance.test.ts).
 *
 * Classic's numbers stay 1.6's: balance-golden.test.ts.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MonsterFlags } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import { balanceDataSchema, DATASET_SCHEMAS } from "@secondstaronline/data/schema";
import {
  BALANCE_DEFAULTS,
  type BalanceRowView,
  buildContentStore,
  type ContentData,
  content,
  deathHunger,
  deathPauseFrames,
  deathVitals,
  hungerTick,
  installContent,
  NO_EQUIPMENT,
  playerSpellAmount,
  type Rng,
  regenTarget,
  regenTick,
  rollAmount,
  spellHitOnMonster,
  stuffedHunger,
  tileLoc,
  useItem,
  type Vitals,
} from "@secondstaronline/shared";

import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { castIntent, swingFireballs } from "../src/systems/spells/cast.ts";
import { argonsFist } from "../src/systems/spells/collide.ts";
import type { Player, Room } from "../src/systems/world/world.ts";
import { manualClock } from "./helpers/manual-clock.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** Classic with its balance (and spells) changed by `edit`, installed. */
function withBalance(edit: (d: ContentData) => void): void {
  const d = structuredClone(classicData) as ContentData;
  edit(d);
  // Only rows the server would accept: the spells and balance schemas, cross-checks included.
  DATASET_SCHEMAS.spells.parse(d.spells);
  balanceDataSchema.parse(d.balance);
  installContent(buildContentStore(d));
}

const fixed = (n: number) => ({ flat: n, power: 0, randomN: 0 });

/** Rolls each draw's n (the highest roll) and records the draws. */
const high = (): Rng & { draws: number[] } => {
  const draws: number[] = [];
  return {
    draws,
    random(n) {
      draws.push(n);
      return n;
    },
  };
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

afterEach(() => {
  installContent(buildContentStore(classicData as ContentData));
});

function scene() {
  const rng = rngByN();
  const map = testMap("x1000y992");
  const { world, join: enter, run } = setup([map], undefined, rng);
  const a = player("Ann", map, 6, 6);
  const b = player("Bob", map, 9, 6);
  for (const p of [a, b]) {
    p.flicker = 0;
    p.char.vitals = { ...p.char.vitals, sp: 200, spMax: 200, hp: 100, hpMax: 100 };
  }
  enter(a);
  enter(b);
  map.flags.canPvp = "X";
  const room = world.rooms.get(map.name) as Room;
  const cast = (p: Player, spell: string, x: number, y: number) => {
    p.timers.actionDelay = 0;
    const t = tileLoc(x, y);
    castIntent(room, p, spell, t.h, t.v, { rng });
  };
  return { map, room, a, b, run, cast };
}

const give = (p: Player, item: string, qty: number) => {
  const i = p.char.bag.indexOf(null);
  p.char.bag[i] = { item, qty };
};

describe("spell amounts play from the balance rows", () => {
  test("an effect's amounts on a player and a monster are its row's, rolled as flat + power × P + random(n)", () => {
    withBalance((d) => {
      const fb = d.balance.spellEffects?.find((r) => r.effect === "Firebolt");
      if (fb) {
        fb.monster = { flat: 40, power: 2, randomN: 0 };
        fb.player = { flat: 50, power: 0, randomN: 4 };
      }
    });
    const r = high();
    expect(spellHitOnMonster("Firebolt-12", {}, 3, 5, r)).toEqual({
      n: 40 + 2 * 5,
      heal: false,
      splat: true,
    });
    expect(r.draws).toEqual([]);
    const bare = { equip: NO_EQUIPMENT, magicShield: false };
    expect(playerSpellAmount("firebolt", 5, bare, r)).toBe(54);
    expect(r.draws).toEqual([4]);
  });

  test("a species an effect heals takes monsterHealed, else the amount on a monster", () => {
    withBalance((d) => {
      for (const row of d.balance.spellEffects ?? []) {
        if (row.effect === "Splash") {
          row.monsterHealed = fixed(11);
        }
        if (row.effect === "Firebolt") {
          row.monster = fixed(7);
        }
      }
    });
    const healed: MonsterFlags = { healedBy: ["Splash", "Firebolt"] };
    expect(spellHitOnMonster("splash-18", healed, 0, 9, high())?.n).toBe(11);
    expect(spellHitOnMonster("Firebolt-12", healed, 0, 9, high())).toEqual({
      n: 7,
      heal: true,
      splat: true,
    });
  });

  test("the healing effects heal a monster and hurt an undead one by their rows", () => {
    withBalance((d) => {
      const mh = d.balance.spellEffects?.find((r) => r.effect === "Minor Heal");
      if (mh) {
        mh.monster = fixed(21);
        mh.monsterUndead = fixed(33);
      }
    });
    expect(spellHitOnMonster("minor heal-3", {}, 0, 1, high())).toEqual({
      n: 21,
      heal: true,
      splat: false,
    });
    expect(spellHitOnMonster("minor heal-3", { hurtByHealing: true }, 0, 1, high())).toEqual({
      n: 33,
      heal: false,
      splat: true,
    });
  });

  test("Spell hits: Dispel's amount, the resisted roll and the arrow floor", () => {
    withBalance((d) => {
      d.balance.spellHits = { dispel: 77, resistedRandomN: 9, arrowsFloorRandomN: 6 };
    });
    expect(spellHitOnMonster("Dispel Illusions-8", { dispellable: true }, 0, 1, high())?.n).toBe(
      77,
    );
    const r = high();
    expect(spellHitOnMonster("crush-18", { resists: ["Crush"] }, 0, 1, r)?.n).toBe(9);
    expect(r.draws.at(-1)).toBe(9);
    // An arrow under 1 after Defense rolls the floor.
    expect(spellHitOnMonster("Blue Arrows", {}, 50, 1, high())?.n).toBe(6);
  });

  test("a spell's own amount replaces its effect's for its hits only (call 3)", () => {
    // Searing Bolt: a second Firebolt with an amount of its own on players.
    withBalance((d) => {
      const fb = d.spells.spells.find((s) => s.name === "Firebolt");
      if (!fb) {
        throw new Error("no Firebolt");
      }
      // Its own FX run, which behaves as Firebolt's (a run's member is unique across spells).
      const run = fb.fx[0];
      if (!run) {
        throw new Error("no Firebolt run");
      }
      d.spells.spells.push({
        ...structuredClone(fb),
        name: "Searing Bolt",
        id: null,
        book: null,
        fx: [{ ...structuredClone(run), member: "Searing Bolt", effect: "Firebolt" }],
        amount: { player: fixed(30) },
      });
      // Its frames hit where Firebolt's do (on a server, the uploaded art's own rects).
      for (let n = 1; n <= run.frames; n++) {
        const rect = d.rects.fx[`firebolt-${n}`];
        if (rect) {
          d.rects.fx[`searing bolt-${n}`] = rect;
        }
      }
    });
    const { a, b, run, cast } = scene();
    a.spell.book = ["Firebolt", "Searing Bolt"];
    give(a, "Red Crystal", 40);
    cast(a, "Searing Bolt", 9, 6);
    run(17);
    expect(b.char.vitals.hp).toBe(100 - 30);
    b.flicker = 0;
    cast(a, "Firebolt", 9, 6);
    run(17);
    // Firebolt keeps its effect's 8 + P + random(3) (P = 3, the sim's rolls).
    const after = b.char.vitals.hp;
    expect(after).toBeLessThan(70);
    expect(70 - after).not.toBe(30);
  });

  test("a spell's own amount on monsters replaces the effect's monster amount", () => {
    withBalance((d) => {
      const fb = d.spells.spells.find((s) => s.name === "Fireball");
      if (fb) {
        fb.amount = { monster: fixed(5) };
      }
    });
    const { map, a, run, cast } = scene();
    const s = map.slots[0] as MonsterSlot;
    s.species = "Slime";
    s.pause = 10_000;
    s.live = {
      name: "Slime",
      hp: 14,
      x: 6,
      y: 5,
      facing: "S",
      anim: 0,
      fromX: 6,
      fromY: 5,
      queue: [],
      hitCountb: 0,
    };
    a.spell.book = ["Fireball"];
    give(a, "Red Crystal", 20);
    cast(a, "Fireball", 6, 5);
    run(1);
    // Fireball's own 4 + P + random(3) would take 10 (balance-golden's Fireball).
    expect(s.live?.hp).toBe(14 - 5);
  });

  test("a free fireball running the spell's FX takes the effect's amount, not the spell's", () => {
    // Firesword's free fireball runs Fireball's FX but is not a Fireball cast (Sol's #19 review).
    withBalance((d) => {
      const fb = d.spells.spells.find((s) => s.name === "Fireball");
      if (fb) {
        fb.amount = { monster: fixed(5) };
      }
    });
    const { map, room, a, run, cast } = scene();
    const s = map.slots[0] as MonsterSlot;
    s.species = "Slime";
    s.pause = 10_000;
    const slime = (hp: number) => {
      s.live = {
        name: "Slime",
        hp,
        x: 6,
        y: 5,
        facing: "S",
        anim: 0,
        fromX: 6,
        fromY: 5,
        queue: [],
        hitCountb: 0,
      };
    };
    // The spellbook cast takes the spell's own 5.
    slime(14);
    a.spell.book = ["Fireball"];
    give(a, "Red Crystal", 20);
    cast(a, "Fireball", 6, 5);
    run(1);
    expect(s.live?.hp).toBe(14 - 5);
    run(40);
    // The free fireball, from the same FX run, takes Fireball's effect amount (more than 5).
    slime(14);
    a.char.equip = { ...a.char.equip, weapon: "Short Sword" };
    a.spell.fireSword = 1000;
    a.facing = "N";
    swingFireballs(room, a, { rng: high() });
    expect(room.fxQueue.map((q) => q.castSpell)).toEqual([undefined]);
    run(20);
    const took = 14 - (s.live?.hp ?? 0);
    expect(took).toBeGreaterThan(5);
  });
});

describe("buffs and cast power play from the balance rows", () => {
  test("Magic Shield, Stone Skin and Diminish Hunger use the buffs row", () => {
    const buffed = (perPower: number) => {
      withBalance((d) => {
        d.balance.buffs = {
          ...BALANCE_DEFAULTS.buffs,
          magicShieldPerPower: perPower,
          stoneSkinPerPower: perPower,
          stoneSkinBonus: 4,
          diminishHunger: { add: 100, below: 2000 },
        };
      });
      const { a, run, cast } = scene();
      a.spell.book = ["Magic Shield", "Stone Skin", "Diminish Hunger"];
      for (const c of ["Blue", "Green", "Purple", "Red", "White", "Yellow"]) {
        give(a, `${c} Crystal`, 20);
      }
      cast(a, "Magic Shield", 6, 6);
      run(14);
      cast(a, "Stone Skin", 6, 6);
      run(14);
      return a;
    };
    // No frames per power: neither buff runs. Many: far longer than Classic's P × 70 and P × 30.
    const none = buffed(0);
    expect([none.spell.magicDef, none.spell.defenseCounter]).toEqual([0, 0]);
    const long = buffed(5000);
    expect(long.spell.magicDef).toBeGreaterThan(4000);
    expect(long.spell.defenseCounter).toBeGreaterThan(4000);
    expect(long.defenseBonus).toBe(4);
  });

  test("a buff whose length is 0 frames gives nothing that would never end", () => {
    // 1.6's counters clear a bonus only when they count down to 0 (Sol's #19 review): a buff of 0
    // frames must not set the bonus at all, or the bonus would stay for good.
    withBalance((d) => {
      d.balance.buffs = {
        ...BALANCE_DEFAULTS.buffs,
        magicShieldPerPower: 0,
        stoneSkinPerPower: 0,
        fireSwordPerPower: 0,
        holdPerPower: 0,
        argonFrames: 0,
      };
    });
    const { a, b, run, cast } = scene();
    a.char.equip = { ...a.char.equip, weapon: "Short Sword" };
    a.spell.book = ["Magic Shield", "Stone Skin", "Firesword", "Argon's Fist", "Hold"];
    for (const c of ["Blue", "Green", "Purple", "Red", "White", "Yellow"]) {
      give(a, `${c} Crystal`, 40);
    }
    for (const spell of ["Magic Shield", "Stone Skin", "Firesword", "Argon's Fist"]) {
      cast(a, spell, 6, 6);
      run(20);
    }
    cast(a, "Hold", 9, 6);
    run(100);
    expect(a.defenseBonus).toBe(0);
    expect(a.attackBonus).toBe(0);
    expect(a.spell.magicDef).toBe(0);
    expect(a.spell.fireSword).toBe(0);
    expect(b.spell.hold).toBe(0);
    // A Purple Potion's Argon's Fist (items.ts) goes through the same call, and the potion gives
    // no Argon's Fist: its words are its use message's in item-rules.json (Classic's names argon,
    // so a world turning Argon's Fist off edits that message too).
    expect(argonsFist(a)).toBe(false);
    expect(a.attackBonus).toBe(0);
    const potion = useItem(
      "Purple Potion",
      { hp: 1, hpMax: 9, sp: 1, spMax: 9, hunger: 1000 },
      high(),
    );
    expect(potion.argon).toBe(false);
    withBalance((d) => {
      d.balance.buffs = { ...BALANCE_DEFAULTS.buffs, argonFrames: 0 };
      d.itemRules.use.messages = d.itemRules.use.messages.filter(
        (m) => m.pattern !== "Purple Potion",
      );
    });
    // Without a message of its own, nothing about argon is said (Neon's #19 review).
    const plain = useItem(
      "Purple Potion",
      { hp: 1, hpMax: 9, sp: 1, spMax: 9, hunger: 1000 },
      high(),
    );
    expect(plain.lines.join(" ")).not.toContain("argon");
  });

  test("Hold, Firesword and Argon's Fist last exactly what their rows give", () => {
    // Each counter is set to its length and counts down once in the frame it lands.
    withBalance((d) => {
      d.balance.buffs = {
        ...BALANCE_DEFAULTS.buffs,
        holdPerPower: 100,
        fireSwordPerPower: 100,
        argonFrames: 777,
      };
    });
    const { a, b, room, run, cast } = scene();
    a.char.equip = { ...a.char.equip, weapon: "Short Sword" };
    a.spell.book = ["Hold", "Firesword", "Argon's Fist"];
    for (const c of ["Blue", "Green", "Purple", "Red", "White", "Yellow"]) {
      give(a, `${c} Crystal`, 40);
    }
    const until = (done: () => boolean) => {
      for (let i = 0; i < 20 && !done(); i++) {
        run(1);
      }
    };
    cast(a, "Hold", 9, 6);
    const holdP = room.fxQueue[0]?.power ?? 0;
    until(() => b.spell.hold > 0);
    expect(b.spell.hold).toBe(holdP * 100 - 1);
    cast(a, "Firesword", 6, 6);
    const swordP = room.fxQueue[0]?.power ?? 0;
    until(() => a.spell.fireSword > 0);
    expect(a.spell.fireSword).toBe(swordP * 100 - 1);
    cast(a, "Argon's Fist", 6, 6);
    until(() => a.timers.attackCounter > 0);
    expect(a.timers.attackCounter).toBe(776);
    expect(a.attackBonus).toBe(1);
  });

  test("the Fire Staff's free fireball takes castPower.staffFireball", () => {
    withBalance((d) => {
      d.balance.castPower = {
        ...BALANCE_DEFAULTS.castPower,
        staffFireball: { flat: 7, randomN: 0 },
      };
    });
    const { a, room } = scene();
    a.char.equip = { ...a.char.equip, weapon: "Fire Staff" };
    swingFireballs(room, a, { rng: high() });
    // A low Staff Fighting adds nothing to it.
    expect(room.fxQueue.map((q) => q.power)).toEqual([7]);
  });

  test("Diminish Hunger adding 0 says nothing", () => {
    withBalance((d) => {
      d.balance.buffs = { ...BALANCE_DEFAULTS.buffs, diminishHunger: { add: 0, below: 2000 } };
    });
    const { a, run, cast } = scene();
    a.spell.book = ["Diminish Hunger"];
    for (const c of ["Blue", "Green", "Purple", "Red", "White", "Yellow"]) {
      give(a, `${c} Crystal`, 20);
    }
    a.char.hunger = 1000;
    cast(a, "Diminish Hunger", 6, 6);
    const said = JSON.stringify(run(14));
    expect(said).not.toContain("hunger has diminished");
    // With something to add, it is said (so the check above can fail).
    withBalance((d) => {
      d.balance.buffs = { ...BALANCE_DEFAULTS.buffs, diminishHunger: { add: 5, below: 2000 } };
    });
    const again = scene();
    again.a.spell.book = ["Diminish Hunger"];
    for (const c of ["Blue", "Green", "Purple", "Red", "White", "Yellow"]) {
      give(again.a, `${c} Crystal`, 20);
    }
    again.a.char.hunger = 1000;
    again.cast(again.a, "Diminish Hunger", 6, 6);
    expect(JSON.stringify(again.run(14))).toContain("hunger has diminished");
  });

  test("a running Firesword is not cut short by a cast of 0 frames", () => {
    withBalance((d) => {
      d.balance.buffs = { ...BALANCE_DEFAULTS.buffs, fireSwordPerPower: 0 };
    });
    const { a, run, cast } = scene();
    a.char.equip = { ...a.char.equip, weapon: "Short Sword" };
    a.spell.book = ["Firesword"];
    give(a, "Red Crystal", 40);
    a.spell.fireSword = 500;
    cast(a, "Firesword", 6, 6);
    run(20);
    expect(a.spell.fireSword).toBeGreaterThan(400);
  });

  test("Diminish Hunger adds the row's hunger, only below its threshold", () => {
    withBalance((d) => {
      d.balance.buffs = { ...BALANCE_DEFAULTS.buffs, diminishHunger: { add: 100, below: 2000 } };
    });
    const { a, run, cast } = scene();
    a.spell.book = ["Diminish Hunger"];
    give(a, "Green Crystal", 20);
    give(a, "Blue Crystal", 20);
    give(a, "Yellow Crystal", 20);
    a.char.hunger = 1999;
    cast(a, "Diminish Hunger", 6, 6);
    run(14);
    const once = a.char.hunger;
    // Hunger falls a little while the FX runs; the cast added 100.
    expect(once).toBeGreaterThan(2000);
    expect(once).toBeLessThanOrEqual(2099);
    cast(a, "Diminish Hunger", 6, 6);
    run(14);
    expect(a.char.hunger).toBeLessThanOrEqual(once);
  });

  test("the free fireballs' power is the castPower row", () => {
    withBalance((d) => {
      d.balance.castPower = {
        staffFireball: { flat: 1, randomN: 3 },
        swordFireball: { flat: 9, randomN: 0 },
      };
    });
    const { a, room } = scene();
    a.char.equip = { ...a.char.equip, weapon: "Short Sword" };
    a.spell.fireSword = 100;
    swingFireballs(room, a, { rng: high() });
    expect(room.fxQueue.map((q) => q.power)).toEqual([9]);
  });

  test("Morph's roll is buffs.morph, and picks the body a cast gives", () => {
    // Classic's morph bodies: a roll above 10 is body 32, above 13 body 31.
    const morphed = (roll: number) => {
      withBalance((d) => {
        d.balance.buffs = { ...BALANCE_DEFAULTS.buffs, morph: fixed(roll) };
      });
      const { a, run, cast } = scene();
      a.spell.book = ["Morph"];
      for (const c of ["Blue", "Green", "Purple", "Red", "White", "Yellow"]) {
        give(a, `${c} Crystal`, 40);
      }
      cast(a, "Morph", 6, 6);
      run(14);
      return a.spell.body;
    };
    expect(morphed(11)).toBe(32);
    expect(morphed(14)).toBe(31);
    expect(rollAmount(content().balance.buffs.morph, 50, high())).toBe(14);
  });
});

describe("regeneration, hunger and death play from the balance rows", () => {
  test("the regen period, amounts and hunger thresholds", () => {
    withBalance((d) => {
      d.balance.regen = { periodFrames: 10, regenerate: 3, starve: 5 };
      d.balance.hunger = {
        loseOneIn: 1,
        regenAbove: 900,
        starveBelow: 100,
        stuffed: 1000,
        afterDeath: 1234,
      };
    });
    expect(regenTarget(0)).toBe(10);
    // A perk larger than the period still leaves a target of 1.
    expect(regenTarget(25)).toBe(1);
    const at = (hunger: number) => {
      const v = vitals(10, 10);
      regenTick(9, 10, hunger, v);
      return [v.hp, v.sp];
    };
    expect(at(901)).toEqual([13, 13]);
    expect(at(900)).toEqual([10, 10]);
    expect(at(99)).toEqual([5, 5]);
    const low = vitals(3, 2);
    regenTick(9, 10, 0, low);
    // Starving never goes below 1.
    expect([low.hp, low.sp]).toEqual([1, 1]);
    // One in 1: hunger falls every frame.
    expect(hungerTick(500, false, high()).hunger).toBe(499);
    expect(stuffedHunger()).toBe(1000);
    expect(
      useItem("Apple", { hp: 1, hpMax: 9, sp: 1, spMax: 9, hunger: 1000 }, high()).consume,
    ).toBe(false);
    expect(deathHunger()).toBe(1234);
  });

  test("what a death leaves: HP and SP at most the player's full, and the pause", () => {
    withBalance((d) => {
      d.balance.death = { hp: 60, sp: 0, pauseFrames: 5 };
    });
    const v = vitals(30, 30);
    deathVitals(v);
    expect([v.hp, v.sp]).toEqual([50, 0]);
    expect(deathPauseFrames()).toBe(5);
  });
});

describe("the rows' limits", () => {
  const parse = (b: unknown) => balanceDataSchema.safeParse(b).success;
  const row = (effect: string, extra: Record<string, unknown> = {}) => ({
    effect,
    monster: fixed(1),
    player: fixed(1),
    ...extra,
  });

  test("Classic's rows parse, and each kind of bad value is refused", () => {
    expect(parse(classicData.balance)).toBe(true);
    const bad: unknown[] = [
      { spellEffects: [row("Firebolt", { monster: { flat: 1, power: 101, randomN: 0 } })] },
      { spellEffects: [row("Firebolt", { monster: { flat: -1, power: 0, randomN: 0 } })] },
      { spellEffects: [row("Firebolt"), row("Firebolt")] },
      { spellEffects: [row("Lightning")] },
      // A healing effect needs its undead amount; only it has one; Arrows heal no species.
      { spellEffects: [row("Minor Heal")] },
      { spellEffects: [row("Firebolt", { monsterUndead: fixed(1) })] },
      { spellEffects: [row("Arrows", { monsterHealed: fixed(1) })] },
      { spellHits: { dispel: 1, resistedRandomN: 0, arrowsFloorRandomN: 1 } },
      { regen: { periodFrames: 0, regenerate: 1, starve: 1 } },
      { death: { hp: 0, sp: 1, pauseFrames: 1 } },
      {
        hunger: { loseOneIn: 0, regenAbove: 500, starveBelow: 50, stuffed: 35000, afterDeath: 1 },
      },
      // Hunger's thresholds in order: starve below regenerate, regenerate at most stuffed.
      {
        hunger: { loseOneIn: 3, regenAbove: 50, starveBelow: 50, stuffed: 35000, afterDeath: 1 },
      },
      { hunger: { loseOneIn: 3, regenAbove: 900, starveBelow: 50, stuffed: 800, afterDeath: 1 } },
    ];
    expect(bad.filter(parse)).toEqual([]);
    expect(parse({ spellEffects: [row("Minor Heal", { monsterUndead: fixed(2) })] })).toBe(true);
  });

  test("a spell row's own amount is bounded by the spells schema", () => {
    const spells = structuredClone(classicData.spells);
    const fb = spells.spells.find((s) => s.name === "Firebolt");
    if (!fb) {
      throw new Error("no Firebolt");
    }
    fb.amount = { player: fixed(5) };
    expect(DATASET_SCHEMAS.spells.safeParse(spells).success).toBe(true);
    fb.amount = { player: { flat: 5, power: 0, randomN: 5000 } };
    expect(DATASET_SCHEMAS.spells.safeParse(spells).success).toBe(false);
  });
});

describe("the Balance page's spell, buff and vitals rows", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "sso-balance-spells-"));
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
      isoNow: () => "2026-11-24T00:00:00.000Z",
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

  const view = (s: RunningServer, part: string, key: string | null = null): BalanceRowView => {
    const r = s.content
      .balanceView()
      .groups.flatMap((g) => g.rows)
      .find((x) => x.part === part && x.key === key);
    if (!r) {
      throw new Error(`no row ${part}/${key}`);
    }
    return r;
  };

  test("every effect has a row with its amounts' three parts, and a publish plays at once", async () => {
    const server = start();
    try {
      const rows = server.content
        .balanceView()
        .groups.filter((g) => g.id !== "vehicles")
        .flatMap((g) => g.rows.map((r) => `${r.part}/${r.key ?? ""}`));
      expect(rows).toEqual([
        "spellEffects/Firebolt",
        "spellEffects/Fireball",
        "spellEffects/Bolt",
        "spellEffects/Meteor",
        "spellEffects/Splash",
        "spellEffects/Crush",
        "spellEffects/Wind Wave",
        "spellEffects/Arrows",
        "spellEffects/Minor Heal",
        "spellEffects/Major Heal",
        "spellHits/",
        "buffs/",
        "castPower/",
        "regen/",
        "hunger/",
        "death/",
      ]);
      // House rest is houses.restRegen, named on the card with a link there (Sol's #19 review).
      const vitals = server.content.balanceView().groups.find((g) => g.id === "vitals");
      expect(vitals?.elsewhere).toEqual([
        {
          label: "Resting in a house",
          row: { dataset: "houses", part: "restRegen", key: null },
          now: "+1 HP and SP with a chance of 1 in 10 each frame, on a house map's rows up to 10",
        },
      ]);
      // The regen period is a counter: it acts every period − 1 frames.
      expect(view(server, "regen").fields[0]).toMatchObject({
        path: ["periodFrames"],
        unit: "counter",
      });
      const fb = view(server, "spellEffects", "Firebolt");
      expect(fb.fields.map((f) => [f.path.join("."), f.unit, f.optional ?? false])).toEqual([
        ["monster.flat", "count", false],
        ["monster.power", "power", false],
        ["monster.randomN", "random", false],
        ["monsterHealed.flat", "count", true],
        ["monsterHealed.power", "power", true],
        ["monsterHealed.randomN", "random", true],
        ["player.flat", "count", false],
        ["player.power", "power", false],
        ["player.randomN", "random", false],
      ]);
      expect(fb).toMatchObject({
        engine: BALANCE_DEFAULTS.spellEffects[0],
        pack: BALANCE_DEFAULTS.spellEffects[0],
        edited: false,
      });
      // A keyed row's refusal names its field too (the entry's index is not the operator's).
      const huge = {
        ...BALANCE_DEFAULTS.spellEffects[0],
        monster: { ...fixed(1), randomN: 10 ** 9 },
      };
      const refused = server.content.draftBalance(ADMIN, {
        part: "spellEffects",
        key: "Firebolt",
        op: "set",
        data: huge,
        expect: fb.fingerprint,
      });
      expect(refused.ok ? [] : (refused.problems ?? []).map((p) => p.where)).toEqual([
        fb.fields.find((f) => f.path.join(".") === "monster.randomN")?.label ?? "?",
      ]);
      const hot = { ...BALANCE_DEFAULTS.spellEffects[0], monster: fixed(99) };
      expect(
        server.content.draftBalance(ADMIN, {
          part: "spellEffects",
          key: "Firebolt",
          op: "set",
          data: hot,
          expect: fb.fingerprint,
        }),
      ).toEqual({ ok: true, value: "Firebolt is in the draft." });
      expect(spellHitOnMonster("Firebolt-12", {}, 0, 1, high())?.n).toBe(6 + 1 + 3);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "Hot").ok).toBe(true);
      expect(spellHitOnMonster("Firebolt-12", {}, 0, 1, high())?.n).toBe(99);
      // Reset brings the pack's value back once published.
      expect(
        server.content.draftBalance(ADMIN, {
          part: "spellEffects",
          key: "Firebolt",
          op: "revert",
          data: null,
          expect: view(server, "spellEffects", "Firebolt").fingerprint,
        }).ok,
      ).toBe(true);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "Back").ok).toBe(true);
      expect(spellHitOnMonster("Firebolt-12", {}, 0, 1, high())?.n).toBe(6 + 1 + 3);
    } finally {
      await server.stop();
    }
  });

  test("a hunger change with its thresholds out of order is refused at save, and nothing plays it", async () => {
    const server = start();
    try {
      const h = view(server, "hunger");
      const r = server.content.draftBalance(ADMIN, {
        part: "hunger",
        key: null,
        op: "set",
        data: { ...BALANCE_DEFAULTS.hunger, starveBelow: 600 },
        expect: h.fingerprint,
      });
      expect(r.ok).toBe(false);
      // Said in the page's words, not the dataset's (Sol's #19 review).
      expect(r).toEqual({
        ok: false,
        error: "Hunger was not saved.",
        problems: [
          { where: "Starves below", message: `"Starves below" must be below "Regenerates above"` },
        ],
      });
      expect(view(server, "hunger").pending).toBeNull();
      expect(content().balance.hunger.starveBelow).toBe(50);
    } finally {
      await server.stop();
    }
  });

  test("an optional amount left out is taken out of the row: the healed species then takes the monster amount", async () => {
    const server = start();
    try {
      const splash = view(server, "spellEffects", "Splash");
      const { monsterHealed: _gone, ...rest } = splash.draft as Record<string, unknown>;
      expect(
        server.content.draftBalance(ADMIN, {
          part: "spellEffects",
          key: "Splash",
          op: "set",
          data: rest,
          expect: splash.fingerprint,
        }).ok,
      ).toBe(true);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "Splash").ok).toBe(true);
      // Healed by Splash: 20 + P + random(3), the amount on a monster, not 10 + P + random(5).
      expect(spellHitOnMonster("splash-18", { healedBy: ["Splash"] }, 0, 1, high())).toEqual({
        n: 24,
        heal: true,
        splat: true,
      });
    } finally {
      await server.stop();
    }
  });

  test("a Minimal world shows every row on the engine's defaults, with no pack value", async () => {
    const server = start("minimal");
    try {
      // House rest is named whatever the pack (Minimal's houses row carries the engine's rule).
      const vitals = server.content.balanceView().groups.find((g) => g.id === "vitals");
      expect(vitals?.elsewhere?.[0]?.row).toEqual({
        dataset: "houses",
        part: "restRegen",
        key: null,
      });
      for (const [part, key] of [
        ["spellEffects", "Firebolt"],
        ["buffs", null],
        ["hunger", null],
        ["death", null],
      ] as const) {
        const r = view(server, part, key);
        expect(r.pack).toBeNull();
        expect(r.published).toEqual(r.engine);
      }
      expect(content().balance.hunger).toEqual(BALANCE_DEFAULTS.hunger);
    } finally {
      await server.stop();
    }
  });
});
