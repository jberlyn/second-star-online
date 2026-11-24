/**
 * Schema for the `balance` dataset (issue #19): the game's global balance numbers, edited on the
 * Control Panel's Balance page. Every value has an engine default (shared `BALANCE_DEFAULTS`,
 * 1.6's own numbers), so a pack may leave the dataset or any part of it out and the engine plays
 * the defaults. The Classic pack writes 1.6's values out.
 *
 * Small groups are one row each (`spellHits`, `buffs`, `castPower`, `regen`, `hunger`, `death`,
 * `vehicles`, `cannon`); lists of like things are keyed rows (`spellEffects` by effect, `hulls` by
 * vehicle), so a pack update that changes one value notices only its row.
 *
 * Every value is bounded, so a typo can never stall or break the game; the server refuses a value
 * outside its limits when it is saved, published, undone or taken from a pack update.
 *
 * Server-only: the client predicts none of these.
 */
import { z } from "zod";

/** The limits of every balance value, shown on the Balance page beside each field. */
export const BALANCE_LIMITS = {
  /** A fixed part of an amount (`flat`). */
  flat: { min: 0, max: 10_000 },
  /** The `random(n)` part of an amount: 0 rolls nothing. */
  randomN: { min: 0, max: 1_000 },
  /** A time in frames (20 a second): up to an hour. */
  frames: { min: 0, max: 72_000 },
  /** A vehicle's full hull. */
  hull: { min: 1, max: 100_000 },
  /** What one hit takes off a hull. */
  hullHit: { min: 0, max: 100_000 },
  /** Hull a parked vehicle regains each whole minute. */
  repairPerMinute: { min: 0, max: 100_000 },
  /** How many times the caster's power an amount adds (`power`): 0 adds none. */
  power: { min: 0, max: 100 },
  /** Frames a buff lasts for each point of the caster's power. */
  perPower: { min: 0, max: 10_000 },
  /** A small bonus (Stone Skin's defense). */
  bonus: { min: 0, max: 1_000 },
  /** A hunger value (hunger counts down from about 40,000 while you play). */
  hunger: { min: 0, max: 100_000 },
  /** A fixed amount of HP or SP. */
  vitals: { min: 0, max: 100_000 },
  /** A chance, 1 in N. */
  oneIn: { min: 1, max: 1_000_000 },
} as const;

const bounded = (l: { min: number; max: number }) => z.number().int().min(l.min).max(l.max);

/**
 * An amount with no caster power: `flat + random(randomN)` (Lingo's `random(n)` is 1 to n; with
 * `randomN` 0 nothing is rolled). The form `attpower.json` uses.
 */
export const flatAmountSchema = z.strictObject({
  flat: bounded(BALANCE_LIMITS.flat),
  randomN: bounded(BALANCE_LIMITS.randomN),
});

/**
 * An amount a spell deals or heals: `flat + power × P + random(randomN)`, where P is the caster's
 * spell power (1.6's `6 + P + random(3)` is `{ flat: 6, power: 1, randomN: 3 }`).
 */
export const amountSchema = z.strictObject({
  flat: bounded(BALANCE_LIMITS.flat),
  power: bounded(BALANCE_LIMITS.power),
  randomN: bounded(BALANCE_LIMITS.randomN),
});

/**
 * The spell effects whose amounts are balance rows: the 1.6 effects that deal or heal an amount,
 * and arrows. A spell runs one by its `effect`.
 */
export const BALANCE_SPELL_EFFECTS = [
  "Arrows",
  "Minor Heal",
  "Major Heal",
  "Meteor",
  "Bolt",
  "Splash",
  "Crush",
  "Firebolt",
  "Fireball",
  "Wind Wave",
] as const;

/** The healing effects: they heal a monster (and a player), and hurt an undead monster. */
export const BALANCE_HEAL_EFFECTS: readonly BalanceSpellEffect[] = ["Minor Heal", "Major Heal"];

/** A spell row's own amounts (`spells.json` `amount`): each part it sets replaces its effect's. */
export const spellAmountOverrideSchema = z.strictObject({
  monster: amountSchema.optional(),
  monsterHealed: amountSchema.optional(),
  monsterUndead: amountSchema.optional(),
  player: amountSchema.optional(),
});

/**
 * What one spell effect deals or heals (issue #19): `monster` on a monster (a heal for the healing
 * effects; arrows take the monster's Defense off it), `monsterHealed` on a species the effect heals
 * (absent: `monster`), `monsterUndead` the damage a healing effect does to an undead monster, and
 * `player` on a player (a heal for the healing effects; most harmful ones then pass the player's
 * spell defense).
 */
export const spellEffectRowSchema = z
  .strictObject({
    effect: z.enum(BALANCE_SPELL_EFFECTS),
    monster: amountSchema,
    monsterHealed: amountSchema.optional(),
    monsterUndead: amountSchema.optional(),
    player: amountSchema,
  })
  .superRefine((r, ctx) => {
    const heal = BALANCE_HEAL_EFFECTS.includes(r.effect);
    if (heal && !r.monsterUndead) {
      ctx.addIssue({
        code: "custom",
        path: ["monsterUndead"],
        message: `${r.effect} needs monsterUndead: what it does to an undead monster`,
      });
    }
    if (!heal && r.monsterUndead) {
      ctx.addIssue({
        code: "custom",
        path: ["monsterUndead"],
        message: `only a healing effect has monsterUndead`,
      });
    }
    if ((heal || r.effect === "Arrows") && r.monsterHealed) {
      ctx.addIssue({
        code: "custom",
        path: ["monsterHealed"],
        message: `${r.effect} heals no species: it has no monsterHealed`,
      });
    }
  });

/** The fixed parts of a spell's hit on a monster. */
export const spellHitsSchema = z.strictObject({
  /** What Dispel Illusions takes off a dispellable monster. */
  dispel: bounded(BALANCE_LIMITS.flat),
  /** A species that resists an effect takes `random(n)` instead of the amount. */
  resistedRandomN: bounded(BALANCE_LIMITS.randomN).min(1),
  /** An arrow that does less than 1 after the monster's Defense does `random(n)`. */
  arrowsFloorRandomN: bounded(BALANCE_LIMITS.randomN).min(1),
});

/** The buff spells' numbers. */
export const buffsSchema = z.strictObject({
  /** Magic Shield lasts this many frames for each point of power. */
  magicShieldPerPower: bounded(BALANCE_LIMITS.perPower),
  /** Stone Skin lasts this many frames for each point of power. */
  stoneSkinPerPower: bounded(BALANCE_LIMITS.perPower),
  /** Stone Skin's defense bonus. */
  stoneSkinBonus: bounded(BALANCE_LIMITS.bonus),
  /** Firesword lasts this many frames for each point of power. */
  fireSwordPerPower: bounded(BALANCE_LIMITS.perPower),
  /** Hold holds this many frames for each point of power. */
  holdPerPower: bounded(BALANCE_LIMITS.perPower),
  /** Argon's Fist (and a Purple Potion) lasts this many frames. */
  argonFrames: bounded(BALANCE_LIMITS.frames),
  /** Diminish Hunger adds `add` to a player's hunger below `below`. */
  diminishHunger: z.strictObject({
    add: bounded(BALANCE_LIMITS.hunger),
    below: bounded(BALANCE_LIMITS.hunger),
  }),
  /** Morph's roll: the first morph body whose `above` it passes from the top wins. */
  morph: amountSchema,
});

/** The power of a weapon's free fireball. */
export const castPowerSchema = z.strictObject({
  /** A Fire Staff's fireball, before its Fire Staff skill steps. */
  staffFireball: flatAmountSchema,
  /** A sword's fireball while Firesword runs. */
  swordFireball: flatAmountSchema,
});

/** Regeneration: each period, HP and SP regenerate or starve by the hunger thresholds. */
export const regenSchema = z.strictObject({
  /** Frames between regeneration ticks, less a faction's regeneration perk. */
  periodFrames: bounded(BALANCE_LIMITS.frames).min(1),
  /** HP and SP each regenerate by this much a tick. */
  regenerate: bounded(BALANCE_LIMITS.vitals),
  /** HP and SP each starve by this much a tick (never below 1). */
  starve: bounded(BALANCE_LIMITS.vitals),
});

/** Hunger and its thresholds. */
export const hungerSchema = z
  .strictObject({
    /** Each frame, hunger falls by 1 with a chance of 1 in this. */
    loseOneIn: bounded(BALANCE_LIMITS.oneIn),
    /** Hunger above this regenerates. */
    regenAbove: bounded(BALANCE_LIMITS.hunger),
    /** Hunger below this starves. */
    starveBelow: bounded(BALANCE_LIMITS.hunger),
    /** Hunger at or above this refuses food and potions ("You're stuffed!"). */
    stuffed: bounded(BALANCE_LIMITS.hunger),
    /** Hunger after a death. */
    afterDeath: bounded(BALANCE_LIMITS.hunger),
  })
  .superRefine((h, ctx) => {
    if (h.starveBelow >= h.regenAbove) {
      ctx.addIssue({
        code: "custom",
        path: ["starveBelow"],
        message: "starveBelow must be below regenAbove",
      });
    }
    if (h.regenAbove > h.stuffed) {
      ctx.addIssue({
        code: "custom",
        path: ["regenAbove"],
        message: "regenAbove must be at most stuffed",
      });
    }
  });

/** What a death leaves. */
export const deathSchema = z.strictObject({
  /** HP after a death (at most the player's full HP). */
  hp: bounded(BALANCE_LIMITS.vitals).min(1),
  /** SP after a death (at most the player's full SP). */
  sp: bounded(BALANCE_LIMITS.vitals),
  /** Frames after a death in which no monster rolls against you. */
  pauseFrames: bounded(BALANCE_LIMITS.frames),
});

/** The vehicles a hull belongs to (the engine's vehicle kinds). */
export const BALANCE_VEHICLES = ["Boat", "Airship", "Battleship"] as const;

/** A vehicle's full hull (issue #2, an SSO addition: 1.6 had no hulls). */
export const hullRowSchema = z.strictObject({
  vehicle: z.enum(BALANCE_VEHICLES),
  hull: bounded(BALANCE_LIMITS.hull),
});

/** How hits wear a hull and how a parked vehicle mends. */
export const vehicleBalanceSchema = z.strictObject({
  /** What one arrow or harmful spell takes off a rider's hull. */
  hullHit: bounded(BALANCE_LIMITS.hullHit),
  /** Hull a parked vehicle regains for each whole minute parked. */
  repairPerMinute: bounded(BALANCE_LIMITS.repairPerMinute),
});

/** The Battleship's cannon. */
export const cannonBalanceSchema = z.strictObject({
  /** What a cannonball takes off a player's HP, a hull or a monster. */
  damage: flatAmountSchema,
  /** Frames between shots. */
  reloadFrames: bounded(BALANCE_LIMITS.frames).min(1),
});

export const balanceDataSchema = z.strictObject({
  spellEffects: z
    .array(spellEffectRowSchema)
    .refine((rows) => new Set(rows.map((r) => r.effect)).size === rows.length, {
      message: "each spell effect has one row",
    })
    .optional(),
  spellHits: spellHitsSchema.optional(),
  buffs: buffsSchema.optional(),
  castPower: castPowerSchema.optional(),
  regen: regenSchema.optional(),
  hunger: hungerSchema.optional(),
  death: deathSchema.optional(),
  vehicles: vehicleBalanceSchema.optional(),
  cannon: cannonBalanceSchema.optional(),
  hulls: z
    .array(hullRowSchema)
    .refine((rows) => new Set(rows.map((r) => r.vehicle)).size === rows.length, {
      message: "each vehicle has one hull row",
    })
    .optional(),
});

export type FlatAmount = z.infer<typeof flatAmountSchema>;
export type Amount = z.infer<typeof amountSchema>;
export type BalanceSpellEffect = (typeof BALANCE_SPELL_EFFECTS)[number];
export type SpellEffectRow = z.infer<typeof spellEffectRowSchema>;
export type SpellAmountOverride = z.infer<typeof spellAmountOverrideSchema>;
export type HullRow = z.infer<typeof hullRowSchema>;
export type BalanceVehicle = (typeof BALANCE_VEHICLES)[number];
export type VehicleBalance = z.infer<typeof vehicleBalanceSchema>;
export type CannonBalance = z.infer<typeof cannonBalanceSchema>;
export type BalanceData = z.infer<typeof balanceDataSchema>;
