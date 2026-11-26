/**
 * Schema for the `balance` dataset (issue #19): the game's global balance numbers, edited on the
 * Control Panel's Balance page. Every value has an engine default (shared `BALANCE_DEFAULTS`,
 * 1.6's own numbers), so a pack may leave the dataset or any part of it out and the engine plays
 * the defaults. The Classic pack writes 1.6's values out.
 *
 * Small groups are one row each (`spellHits`, `buffs`, `castPower`, `regen`, `hunger`, `death`,
 * `vehicles`, `cannon`, `drops`, `timings`, `combat`, `monsters`, `killXp`, `levels`); lists of
 * like things are keyed
 * rows (`spellEffects` by effect), so a pack update that changes one value notices only its row.
 * Each vehicle's full hull is its `houses.vehicles` row's (issue #44).
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
  /** A speed in percent of the usual (Haste's regeneration): from the usual to ten times it. */
  speedPercent: { min: 100, max: 1_000 },
  /** Frames between poison hits: from every frame to once a minute. */
  poisonEvery: { min: 1, max: 1_200 },
  /** A hunger value (hunger counts down from about 40,000 while you play). */
  hunger: { min: 0, max: 100_000 },
  /** A fixed amount of HP or SP. */
  vitals: { min: 0, max: 100_000 },
  /** A chance, 1 in N. */
  oneIn: { min: 1, max: 1_000_000 },
  /** The most gold a death drops (0: no cap). */
  goldCap: { min: 0, max: 1_000_000_000 },
  /** A character level. */
  level: { min: 0, max: 100_000 },
  /** How long monster loot lasts on the ground, in seconds: a minute to a week. */
  lootSeconds: { min: 60, max: 7 * 24 * 60 * 60 },
  /** A damage floor: damage below this rolls instead (at least 1, so a hit always does 1). */
  floorBelow: { min: 1, max: 10_000 },
  /** An amount of experience. */
  xp: { min: 0, max: 1_000_000_000 },
  /** A percentage of kill XP. */
  percent: { min: 0, max: 10_000 },
  /** How much more each level of the level curve needs than the last, in percent. */
  growth: { min: 0, max: 100 },
  /** The power the level is raised to in the level curve (1: straight, 2: squared …). */
  exponent: { min: 1, max: 4 },
  /** The most entries in a list (bonus thresholds, the first levels' XP). */
  listItems: { min: 0, max: 100 },
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
  "Replenish",
  "Poison Dart",
  "Meteor",
  "Bolt",
  "Splash",
  "Crush",
  "Firebolt",
  "Fireball",
  "Wind Wave",
] as const;

/** The healing effects: they heal a monster (and a player), and hurt an undead monster. */
export const BALANCE_HEAL_EFFECTS: readonly BalanceSpellEffect[] = [
  "Minor Heal",
  "Major Heal",
  "Replenish",
];

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
  /*
   * SSO's additions (issue #17), each optional so a row saved before them plays the defaults. A
   * buff lasts its `…Frames` plus its `…PerPower` for each point of the caster's power, unless the
   * cast spell's own `lasts` says otherwise.
   */
  /** Haste: how long it lasts. */
  hasteFrames: bounded(BALANCE_LIMITS.frames).optional(),
  hastePerPower: bounded(BALANCE_LIMITS.perPower).optional(),
  /** Haste: how fast HP and SP regenerate meanwhile, in percent of the usual speed (200: twice). */
  hasteRegenPercent: bounded(BALANCE_LIMITS.speedPercent).optional(),
  /** Bless: how long it lasts and the attack power it adds. */
  blessFrames: bounded(BALANCE_LIMITS.frames).optional(),
  blessPerPower: bounded(BALANCE_LIMITS.perPower).optional(),
  blessBonus: bounded(BALANCE_LIMITS.bonus).optional(),
  /** Holy Weapon: how long it lasts and the damage it adds to each melee hit (on the undead). */
  holyWeaponFrames: bounded(BALANCE_LIMITS.frames).optional(),
  holyWeaponPerPower: bounded(BALANCE_LIMITS.perPower).optional(),
  holyWeaponBonus: bounded(BALANCE_LIMITS.bonus).optional(),
  holyWeaponUndeadBonus: bounded(BALANCE_LIMITS.bonus).optional(),
  /** Weaken: how long it lasts and the attack it takes off a player or monster. */
  weakenFrames: bounded(BALANCE_LIMITS.frames).optional(),
  weakenPerPower: bounded(BALANCE_LIMITS.perPower).optional(),
  weakenPenalty: bounded(BALANCE_LIMITS.bonus).optional(),
  /**
   * Poison Dart's poison: how long it lasts, and the frames between its hits (each the
   * `spellEffects` "Poison Dart" amount).
   */
  poisonFrames: bounded(BALANCE_LIMITS.frames).optional(),
  poisonPerPower: bounded(BALANCE_LIMITS.perPower).optional(),
  poisonEveryFrames: bounded(BALANCE_LIMITS.poisonEvery).optional(),
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

/** Who sees their own hunger, and how (`hunger.show`): Classic, as 1.6, keeps it hidden. */
export const HUNGER_SHOW = ["hidden", "words", "percent", "number"] as const;

/**
 * What being stuffed refuses (`hunger.stuffedRefuses`): every usable item (1.6, healing potions
 * too), or only food (an item whose use can raise hunger). An item whose use only lowers hunger is
 * never refused.
 */
export const HUNGER_STUFFED_REFUSES = ["all", "food"] as const;

/** The most hunger warnings, and hunger break-odds steps, a world can have. */
export const HUNGER_STEPS_MAX = 20;

/** A hunger warning's longest line. */
export const HUNGER_WARNING_TEXT_MAX = 200;

/** The most a hunger break-odds step can add to the break roll's range. */
export const HUNGER_BREAK_ADD_MAX = 1_000_000;

/**
 * Hunger and its thresholds. The fields after `afterDeath` came later (hunger as content): a row
 * may leave them out, and the engine plays its default for each one it leaves out.
 */
export const hungerSchema = z
  .strictObject({
    /** Each frame, hunger falls by `lose` with a chance of 1 in this. */
    loseOneIn: bounded(BALANCE_LIMITS.oneIn),
    /** Hunger above this regenerates. */
    regenAbove: bounded(BALANCE_LIMITS.hunger),
    /** Hunger below this starves. */
    starveBelow: bounded(BALANCE_LIMITS.hunger),
    /** Hunger at or above this refuses food and potions ("You're stuffed!"). */
    stuffed: bounded(BALANCE_LIMITS.hunger),
    /** Hunger after a death. */
    afterDeath: bounded(BALANCE_LIMITS.hunger),
    /** How much hunger falls each time it falls (0: hunger never falls). Left out: 1. */
    lose: bounded(BALANCE_LIMITS.hunger).optional(),
    /**
     * The most hunger can ever be: food and spells stop there, a new character and a death start
     * no higher, and a saved character above it is brought down to it. At least `stuffed` and
     * `afterDeath`. Left out: 50,000, Classic's starting hunger (the most 1.6 ever gave).
     */
    max: bounded(BALANCE_LIMITS.hunger).optional(),
    /** What being stuffed refuses. Left out: every usable item (1.6). */
    stuffedRefuses: z.enum(HUNGER_STUFFED_REFUSES).optional(),
    /**
     * The lines a player is told as hunger falls to or past `at`, at most one a frame (the lowest
     * passed). Left out: 1.6's three, at 1,500, 1,000 and 500.
     */
    warnings: z
      .array(
        z.strictObject({
          at: bounded(BALANCE_LIMITS.hunger),
          text: z.string().trim().min(1).max(HUNGER_WARNING_TEXT_MAX),
        }),
      )
      .max(HUNGER_STEPS_MAX)
      .refine((w) => new Set(w.map((x) => x.at)).size === w.length, {
        message: "each warning needs its own hunger",
      })
      .optional(),
    /**
     * Above each `above`, `add` more on the equipment break roll's range (a fuller player breaks
     * gear a little less often). Left out: 1.6's +10, +30, +40, +50 above 20k, 25k, 30k, 40k.
     */
    breakOdds: z
      .array(
        z.strictObject({
          above: bounded(BALANCE_LIMITS.hunger),
          add: bounded({ min: 0, max: HUNGER_BREAK_ADD_MAX }),
        }),
      )
      .max(HUNGER_STEPS_MAX)
      .refine((b) => new Set(b.map((x) => x.above)).size === b.length, {
        message: "each step needs its own hunger",
      })
      .optional(),
    /** Whether players see their own hunger on the Stats tab, and how. Left out: hidden (1.6). */
    show: z.enum(HUNGER_SHOW).optional(),
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
    // Left out, the maximum is the engine's 50,000.
    const max = h.max ?? 50_000;
    if (max < h.stuffed) {
      ctx.addIssue({
        code: "custom",
        path: ["max"],
        message: "max must be at least stuffed",
      });
    }
    if (max < h.afterDeath) {
      ctx.addIssue({
        code: "custom",
        path: ["afterDeath"],
        message: "afterDeath must be at most max",
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

/**
 * The monsters' global rolls (issue #31): how often a map's monsters move and spawn, by the players
 * on the map, and the rolls inside a move and a spawn. Every chance is at least 1, so a roll is
 * always drawn as it was.
 */
/**
 * The four roster slots. The move pick and the faction slot pick are `random(n)` over them: below
 * this a pick could never reach the later slots (and a faction pick would always take one).
 */
export const ROSTER_SLOTS = 4;

export const monstersBalanceSchema = z.strictObject({
  /**
   * Twice each frame, for each player on the map (at most 15), one slot's monster is picked to move
   * by `random(n)` (slot n moves, 1 to 4), n by the players on the map: 1, 2, … 8 or more. At least
   * 4, so every slot of the roster can be picked.
   */
  moveLadder: z.array(bounded({ min: ROSTER_SLOTS, max: BALANCE_LIMITS.oneIn.max })).length(8),
  /** A walk is `random(n)` steps long. */
  walkStepsRandomN: bounded(BALANCE_LIMITS.randomN).min(1),
  /**
   * Twice each frame, for each player on the map (at most 15), a spawn pass goes ahead with a chance
   * of 1 in n, n by the players on the map: 1, 2, … 7 or more.
   */
  spawnLadder: z.array(bounded(BALANCE_LIMITS.oneIn)).length(7),
  /** In a pass, each empty slot spawns with a chance of 1 in this. */
  slotOneIn: bounded(BALANCE_LIMITS.oneIn),
  /**
   * On a faction's map, `random(n)` picks the slot its member takes (1 to 4; above 4, none). At
   * least 4, so the member can take any slot and every slot's own species can still spawn.
   */
  factionSlotRandomN: bounded({ min: ROSTER_SLOTS, max: BALANCE_LIMITS.randomN.max }),
  /** An NPC's slot spawns only when `random(randomN)` is at most `passAtMost`. */
  npcSpawn: z
    .strictObject({
      randomN: bounded(BALANCE_LIMITS.randomN).min(1),
      passAtMost: bounded(BALANCE_LIMITS.randomN),
    })
    .refine((n) => n.passAtMost <= n.randomN, {
      path: ["passAtMost"],
      message: "passAtMost must be at most randomN",
    }),
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

/** Whose deaths drop gold or an item. */
export const BALANCE_DROP_WHO = ["off", "wanted", "pvp", "everyone"] as const;
/** What a death drop can be. */
export const BALANCE_DROP_KIND = ["either", "gold", "items"] as const;

/**
 * Death drops and monster loot (moved from Server Settings in issue #19 stage 4): whose deaths drop
 * gold or one bag item, which of the two, the gold cap, the level below which nothing drops, and
 * how long monster loot lasts on the ground.
 */
export const dropsSchema = z.strictObject({
  who: z.enum(BALANCE_DROP_WHO),
  kind: z.enum(BALANCE_DROP_KIND),
  /** The most gold a death drops unless the character is wanted; 0 for no cap. */
  goldCap: bounded(BALANCE_LIMITS.goldCap),
  /** A character below this level drops nothing unless wanted; 0 protects no one. */
  minLevel: bounded(BALANCE_LIMITS.level),
  /** Seconds monster loot stays on the ground. */
  lootDecaySeconds: bounded(BALANCE_LIMITS.lootSeconds),
});

/** Timings, in frames (20 a second). */
export const timingsSchema = z.strictObject({
  /** A hit player's flicker, in which no other hit lands. */
  flickerFrames: bounded(BALANCE_LIMITS.frames),
  /** After a cast, before the caster may act again (at least 1, or casts in one frame all pass). */
  castDelayFrames: bounded(BALANCE_LIMITS.frames).min(1),
  /** A swing's cooldown with no gear that sets one (at least 1, or a swing would never rearm). */
  swingBaseFrames: bounded(BALANCE_LIMITS.frames).min(1),
  /**
   * How long a player's hit still counts as the kill (at least 1: a melee, monster or cannon hit
   * lands after the tick's death check, so the fatal one is 1 frame old when judged).
   */
  killCreditFrames: bounded(BALANCE_LIMITS.frames).min(1),
  /** After grabbing a pig, before the next grab. */
  pigGrabFrames: bounded(BALANCE_LIMITS.frames),
  /** Between a give's drop and the receiver picking it up. */
  giveGrabFrames: bounded(BALANCE_LIMITS.frames),
  /** After a monster's spell, before another monster spell may hit the same players. */
  npcSpellBlockFrames: bounded(BALANCE_LIMITS.frames),
});

/** A damage floor: damage below `below` becomes `random(randomN)`. */
export const floorSchema = z.strictObject({
  below: bounded(BALANCE_LIMITS.floorBelow),
  randomN: bounded(BALANCE_LIMITS.randomN).min(1),
});

/** The rolls inside the combat formulas. */
export const combatSchema = z.strictObject({
  /** A melee hit on a monster below this, after its Defense, rolls instead. */
  meleeFloor: floorSchema,
  /** A hit on a player (a monster's or a player's) below this, after defense, rolls instead. */
  playerHitFloor: floorSchema,
  /** A parry or block succeeds on a 1: its base roll, before the skill's ladder. */
  dodgeBaseRandomN: bounded(BALANCE_LIMITS.randomN).min(1),
  /** A monster next to a player attacks each frame with a chance of 1 in this. */
  monsterMeleeOneIn: bounded(BALANCE_LIMITS.oneIn),
  /** Walking into a player pushes them with a chance of 1 in this. */
  pushOneIn: bounded(BALANCE_LIMITS.oneIn),
});

/** How kill XP follows the levels of the killer and the monster (issue #42). */
export const KILL_XP_ADJUST = ["minusLevel", "none", "levelDifference"] as const;

/**
 * Kill XP (issue #42): what killing a monster gives the killer's character level. In order:
 *
 * 1. the species' base XP for the kind of kill (`xpMelee` or `xpSpell`); a species with neither
 *    works it out from its level (`fromLevel`: `flat + perLevel × level`), and a name with no
 *    species gives `noSpecies`;
 * 2. plus the worn gear's `killXp` (item rules; Classic: the Ring of Experience's 5);
 * 3. replaced by the species' fixed `killXp` (Classic: Cow and Holy Shield, 5);
 * 4. plus `bonus` (1.6's `Regged` bonus, always on: 10);
 * 5. plus `thresholdBonus` for each of `thresholds` the value is above, tested in order on the
 *    growing value (1.6: 10 for each of 100, 150 … 400);
 * 6. adjusted by the levels (`adjust`): `minusLevel` takes the killer's level off (1.6), `none`
 *    keeps it whatever the level (RuneScape), and `levelDifference` scales it by the monster's
 *    level against the killer's: `belowPercent` less for each level the monster is below, and
 *    `abovePercent` more for each level above, between 0 and `maxPercent` percent (a monster with
 *    no level counts as the killer's level). Never below 0.
 */
export const killXpSchema = z
  .strictObject({
    noSpecies: bounded(BALANCE_LIMITS.xp),
    fromLevel: z.strictObject({
      flat: bounded(BALANCE_LIMITS.xp),
      perLevel: bounded(BALANCE_LIMITS.xp),
    }),
    bonus: bounded(BALANCE_LIMITS.xp),
    thresholds: z.array(bounded(BALANCE_LIMITS.xp)).max(BALANCE_LIMITS.listItems.max),
    thresholdBonus: bounded(BALANCE_LIMITS.xp),
    adjust: z.enum(KILL_XP_ADJUST),
    belowPercent: bounded(BALANCE_LIMITS.percent),
    abovePercent: bounded(BALANCE_LIMITS.percent),
    maxPercent: bounded(BALANCE_LIMITS.percent),
  })
  .refine((k) => k.thresholds.every((t, i) => i === 0 || t > (k.thresholds[i - 1] ?? 0)), {
    path: ["thresholds"],
    message: "thresholds must rise",
  });

/** How a level's XP is counted (issue #42). */
export const LEVEL_COUNTING = ["perLevel", "total"] as const;
/** Whether players see monster levels. */
export const MONSTER_LEVEL_DISPLAY = ["hidden", "shown"] as const;

/**
 * The character level curve and what each level gives (issue #42). Leaving level L takes, while
 * `firstLevels` lasts, its entry for L (the first is level 1's), then
 * `floor((start + perLevel × L^exponent) × (1 + growthPercent / 100)^(L − 1))`. With `counting`
 * `perLevel` that is the XP from L to L + 1, counted from 0 within each level with leftovers
 * carried (1.6: 30, 400, then 400 + 2 × L); with `total` it is the running total that reaches
 * L + 1, and the XP bar shows the running total. `cap` is the highest level (absent: none). Each
 * level gained adds `hpPerLevel` and `spPerLevel` to the most HP and SP (1.6: 1 and 1).
 * `showMonsterLevels` shows each monster's level (`monsters.json` `level`) beside its name.
 */
export const levelsSchema = z.strictObject({
  counting: z.enum(LEVEL_COUNTING),
  firstLevels: z.array(bounded(BALANCE_LIMITS.xp)).max(BALANCE_LIMITS.listItems.max),
  start: bounded(BALANCE_LIMITS.xp),
  perLevel: bounded(BALANCE_LIMITS.xp),
  exponent: bounded(BALANCE_LIMITS.exponent),
  growthPercent: bounded(BALANCE_LIMITS.growth),
  cap: bounded({ min: 1, max: BALANCE_LIMITS.level.max }).optional(),
  hpPerLevel: bounded(BALANCE_LIMITS.vitals),
  spPerLevel: bounded(BALANCE_LIMITS.vitals),
  showMonsterLevels: z.enum(MONSTER_LEVEL_DISPLAY),
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
  drops: dropsSchema.optional(),
  timings: timingsSchema.optional(),
  combat: combatSchema.optional(),
  monsters: monstersBalanceSchema.optional(),
  killXp: killXpSchema.optional(),
  levels: levelsSchema.optional(),
});

export type FlatAmount = z.infer<typeof flatAmountSchema>;
export type Amount = z.infer<typeof amountSchema>;
export type BalanceSpellEffect = (typeof BALANCE_SPELL_EFFECTS)[number];
export type SpellEffectRow = z.infer<typeof spellEffectRowSchema>;
export type SpellAmountOverride = z.infer<typeof spellAmountOverrideSchema>;
export type VehicleBalance = z.infer<typeof vehicleBalanceSchema>;
export type CannonBalance = z.infer<typeof cannonBalanceSchema>;
export type BalanceDrops = z.infer<typeof dropsSchema>;
export type BalanceTimings = z.infer<typeof timingsSchema>;
export type BalanceCombat = z.infer<typeof combatSchema>;
export type BalanceMonsters = z.infer<typeof monstersBalanceSchema>;
export type BalanceKillXp = z.infer<typeof killXpSchema>;
export type BalanceLevels = z.infer<typeof levelsSchema>;
export type BalanceData = z.infer<typeof balanceDataSchema>;
export type BalanceHunger = z.infer<typeof hungerSchema>;
