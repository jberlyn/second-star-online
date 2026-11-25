/**
 * The balance numbers (issue #19): the engine's default for every value, and the store's full
 * balance, a world's `balance` dataset with every part it leaves out filled from the defaults.
 *
 * The defaults are the numbers the engine played before they became content: 1.6's where 1.6 had
 * them, SSO's own for its additions (hull wear and the cannon, issue #2; each vehicle's full hull is its
 * `houses.vehicles` row's, issue #44). The Classic pack
 * writes the same values out; a pack that leaves a part out (Minimal leaves them all) plays these.
 */
import type {
  Amount,
  BalanceData,
  BalanceSpellEffect,
  FlatAmount,
  SpellAmountOverride,
  SpellEffectRow,
} from "@secondstaronline/data";

import { TICK_HZ } from "../constants.ts";
import type { Rng } from "../rules/core/lingo.ts";

/** A world's balance with every part present. */
export interface Balance {
  /** One row for each effect, in `BALANCE_SPELL_EFFECT_ORDER`. */
  spellEffects: SpellEffectRow[];
  spellHits: NonNullable<BalanceData["spellHits"]>;
  buffs: NonNullable<BalanceData["buffs"]>;
  castPower: NonNullable<BalanceData["castPower"]>;
  regen: NonNullable<BalanceData["regen"]>;
  hunger: NonNullable<BalanceData["hunger"]>;
  death: NonNullable<BalanceData["death"]>;
  vehicles: NonNullable<BalanceData["vehicles"]>;
  cannon: NonNullable<BalanceData["cannon"]>;
  drops: NonNullable<BalanceData["drops"]>;
  timings: NonNullable<BalanceData["timings"]>;
  combat: NonNullable<BalanceData["combat"]>;
  monsters: NonNullable<BalanceData["monsters"]>;
}

/** The spell effects with amounts, in the order the Balance page lists them. */
export const BALANCE_SPELL_EFFECT_ORDER: readonly BalanceSpellEffect[] = [
  "Firebolt",
  "Fireball",
  "Bolt",
  "Meteor",
  "Splash",
  "Crush",
  "Wind Wave",
  "Arrows",
  "Minor Heal",
  "Major Heal",
];

/** `flat + P + random(randomN)`: most of 1.6's spell amounts. */
const plusP = (flat: number, randomN: number): Amount => ({ flat, power: 1, randomN });

/** The engine's defaults: what a world plays for every value its packs and operator leave out. */
export const BALANCE_DEFAULTS: Readonly<Balance> = {
  spellEffects: [
    { effect: "Firebolt", monster: plusP(6, 3), player: plusP(8, 3) },
    { effect: "Fireball", monster: plusP(4, 3), player: plusP(9, 3) },
    { effect: "Bolt", monster: plusP(15, 3), player: plusP(18, 8) },
    { effect: "Meteor", monster: plusP(15, 3), player: plusP(15, 3) },
    { effect: "Splash", monster: plusP(20, 3), monsterHealed: plusP(10, 5), player: plusP(20, 3) },
    { effect: "Crush", monster: plusP(6, 3), monsterHealed: plusP(8, 3), player: plusP(6, 3) },
    { effect: "Wind Wave", monster: plusP(2, 5), player: plusP(2, 5) },
    { effect: "Arrows", monster: plusP(0, 0), player: plusP(0, 2) },
    {
      effect: "Minor Heal",
      monster: plusP(3, 5),
      monsterUndead: plusP(1, 2),
      player: plusP(2, 2),
    },
    {
      effect: "Major Heal",
      monster: plusP(15, 10),
      monsterUndead: plusP(5, 5),
      player: plusP(15, 5),
    },
  ],
  spellHits: { dispel: 2000, resistedRandomN: 3, arrowsFloorRandomN: 2 },
  buffs: {
    magicShieldPerPower: 70,
    stoneSkinPerPower: 30,
    stoneSkinBonus: 1,
    fireSwordPerPower: 40,
    holdPerPower: 8,
    argonFrames: 400,
    diminishHunger: { add: 3000, below: 35_000 },
    morph: plusP(3, 5),
  },
  castPower: {
    staffFireball: { flat: 1, randomN: 3 },
    swordFireball: { flat: 4, randomN: 3 },
  },
  // 1.6's regen target `60 - speed + (90 - perk)` with speed always 1: 149 less the perk.
  regen: { periodFrames: 149, regenerate: 1, starve: 1 },
  hunger: { loseOneIn: 3, regenAbove: 500, starveBelow: 50, stuffed: 35_000, afterDeath: 40_000 },
  death: { hp: 1, sp: 1, pauseFrames: 90 },
  vehicles: { hullHit: 2, repairPerMinute: 1 },
  cannon: { damage: { flat: 13, randomN: 3 }, reloadFrames: 5 * TICK_HZ },
  // Moved from Server Settings (stage 4): SSO's defaults there. 1.6 dropped on every death.
  drops: {
    who: "wanted",
    kind: "either",
    goldCap: 200,
    minLevel: 0,
    lootDecaySeconds: 30 * 60,
  },
  timings: {
    flickerFrames: 40,
    castDelayFrames: 20,
    swingBaseFrames: 14,
    killCreditFrames: 40,
    pigGrabFrames: 500,
    // 3 s: 1.6's 180 frames of 1/60 s.
    giveGrabFrames: 60,
    npcSpellBlockFrames: 30,
  },
  combat: {
    meleeFloor: { below: 1, randomN: 3 },
    playerHitFloor: { below: 2, randomN: 3 },
    dodgeBaseRandomN: 90,
    monsterMeleeOneIn: 10,
    pushOneIn: 25,
  },
  // 1.6's monster rolls (issue #31). The move ladder's eighth step is SSO's (a bug fixed: 1.6 fell
  // back to 50 from the 9th player).
  monsters: {
    moveLadder: [30, 50, 70, 100, 200, 300, 400, 600],
    walkStepsRandomN: 10,
    spawnLadder: [80, 120, 230, 400, 600, 900, 1300],
    slotOneIn: 5,
    factionSlotRandomN: 35,
    npcSpawn: { randomN: 60, passAtMost: 2 },
  },
};

/**
 * A world's full balance: each part it sets, else the default. Pure; nothing is shared with
 * `data`.
 */
export function fullBalance(data: BalanceData | undefined): Balance {
  const d = data ?? {};
  const spellEffects = BALANCE_SPELL_EFFECT_ORDER.map((effect) =>
    structuredClone(
      (d.spellEffects?.find((r) => r.effect === effect) ??
        BALANCE_DEFAULTS.spellEffects.find((r) => r.effect === effect)) as SpellEffectRow,
    ),
  );
  const part = <K extends keyof BalanceData & keyof Balance>(k: K): Balance[K] =>
    structuredClone((d[k] ?? BALANCE_DEFAULTS[k]) as Balance[K]);
  return {
    spellEffects,
    spellHits: part("spellHits"),
    buffs: part("buffs"),
    castPower: part("castPower"),
    regen: part("regen"),
    hunger: part("hunger"),
    death: part("death"),
    vehicles: structuredClone(d.vehicles ?? BALANCE_DEFAULTS.vehicles),
    cannon: structuredClone(d.cannon ?? BALANCE_DEFAULTS.cannon),
    drops: part("drops"),
    timings: part("timings"),
    combat: part("combat"),
    monsters: part("monsters"),
  };
}

/** Rolls an amount: `flat + random(randomN)`, drawing nothing when `randomN` is 0. */
export function rollFlat(a: FlatAmount, rng: Rng): number {
  return a.flat + (a.randomN > 0 ? rng.random(a.randomN) : 0);
}

/**
 * Rolls a spell amount: `flat + power × P + random(randomN)`, drawing nothing when `randomN` is 0
 * (the one draw 1.6 made, in the same place).
 */
export function rollAmount(a: Amount, P: number, rng: Rng): number {
  return a.flat + a.power * P + (a.randomN > 0 ? rng.random(a.randomN) : 0);
}

/** One effect's amounts as a hit uses them: the effect's row, with the cast spell's own parts. */
export interface SpellAmounts {
  monster: Amount;
  /** On a species the effect heals. */
  monsterHealed: Amount;
  /** A healing effect on an undead monster (else `monster`). */
  monsterUndead: Amount;
  player: Amount;
}

/** The amounts of `effect` for a hit, with the parts `override` (the cast spell's `amount`) sets. */
export function spellAmounts(
  row: SpellEffectRow,
  override: SpellAmountOverride | undefined,
): SpellAmounts {
  const monster = override?.monster ?? row.monster;
  return {
    monster,
    monsterHealed: override?.monsterHealed ?? row.monsterHealed ?? monster,
    monsterUndead: override?.monsterUndead ?? row.monsterUndead ?? monster,
    player: override?.player ?? row.player,
  };
}
