/** Schema for monster records, editor lists, name-matched rules, casting, affinities and skill caps. */
import { z } from "zod";

import { bodyNumberSchema } from "./art.ts";
import { patternRow } from "./common.ts";

const int = z.number().int();
const patternEntry = z.strictObject(patternRow);

/** The spell effects (1.6 spell names) whose monster hit a species can be healed by or resist. */
export const MONSTER_HIT_EFFECTS = [
  "Meteor",
  "Bolt",
  "Splash",
  "Crush",
  "Firebolt",
  "Fireball",
  "Wind Wave",
  // SSO's (issue #17): each hit of Poison Dart's poison.
  "Poison Dart",
] as const;
const hitEffect = z.enum(MONSTER_HIT_EFFECTS);

/**
 * What a species does that no other row says: each flag is an engine mechanic (1.6 tied each one
 * to a body number). An absent flag is off.
 */
export const monsterFlagsSchema = z.strictObject({
  /** Never walks (Classic: Illusionary Spikes, Web, Holy Shield). */
  immobile: z.boolean().optional(),
  /** A click on it does nothing (after a grab and a `namesSelf` row). */
  unclickable: z.boolean().optional(),
  /** Holds a player standing on its tile, and never attacks (Classic: Web). */
  trap: z.boolean().optional(),
  /** Dispel Illusions destroys it (Classic: Illusionary Spikes). */
  dispellable: z.boolean().optional(),
  /** An innocent player standing exactly on it cannot be hit (Classic: Holy Shield). */
  shieldsInnocent: z.boolean().optional(),
  /** Ctrl, or a click from the faced tile, picks it up as this item (Classic: a Pig). */
  grabbable: z.string().min(1).optional(),
  /** Minor and Major Heal hurt it instead (Classic: Zombie). */
  hurtByHealing: z.boolean().optional(),
  /** Spell effects that heal it instead of hurting it (1.6 spell names: "Splash", "Crush", "Firebolt"). */
  healedBy: z.array(hitEffect).optional(),
  /** Spell effects whose hit on it deals only `random(3)` (Classic: the Ghoul and "Fireball"). */
  resists: z.array(hitEffect).optional(),
});

export const monsterSchema = z.strictObject({
  /** The species' permanent key: the name it was created with (the 1.6 name for Classic). */
  name: z.string().min(1).max(80),
  /** The name players see, when an operator has renamed the species; the key otherwise. */
  display: z.string().min(1).max(40).optional(),
  /**
   * Cast line 1: the `Chars` body number (1 to 9999, `BODY_MAX`); the sprite member is
   * `<body>-F2-<dir>`. Uploaded bodies are numbered from 1000 (`OPERATOR_BODY_MIN`).
   */
  body: bodyNumberSchema,
  /** False for the bodies with no `Chars` bitmap (hidden from the editor). */
  bodyInMainChars: z.boolean(),
  /** Species hit points; every species has them (at least 1). */
  hp: int.min(1).max(1_000_000_000),
  /** Monster attack table value, or null when the name has no entry (it never melees). */
  attack: int.min(0).max(1_000_000_000).nullable(),
  /** Cast line 3: subtracted from melee AttPower. */
  defense: int.min(0).max(1_000_000_000),
  /**
   * The monster's level (issue #42), 0 to 100,000. Absent: none. The balance row
   * `levels.showMonsterLevels` shows it to players beside the name; the kill XP model's
   * `levelDifference` adjustment and `fromLevel` base read it. Classic sets none.
   */
  level: int.min(0).max(100_000).optional(),
  /**
   * Base XP, melee kill table and spell kill table. Absent: the balance row `killXp.fromLevel`
   * works it out from the species' `level` (0 without one).
   */
  xpMelee: int.min(0).max(1_000_000_000).optional(),
  xpSpell: int.min(0).max(1_000_000_000).optional(),
  /**
   * A fixed kill XP in place of `xpMelee` and `xpSpell` and any XP gear's bonus (issue #42;
   * Classic: Cow and Holy Shield, 5). Absent: none. Before #42 this was the name-matched table
   * `rules.killXp`.
   */
  killXp: int.min(0).max(1_000_000_000).optional(),
  /**
   * The XP a kill gives each `xp`-model skill the weapon trains, replacing the skills' own `kill`
   * amount. Kill XP for the character level is `xpMelee`/`xpSpell`.
   */
  skillXp: int.min(0).max(1_000_000_000).optional(),
  /** Zombie and Skeleton: spawn only while `gt < server minute < lt`. */
  spawnMinute: z.strictObject({ gt: int, lt: int }).nullable(),
  /** The species' engine flags. Absent = none. */
  flags: monsterFlagsSchema.optional(),
});

export const meleeAffinitySchema = z.strictObject({
  weapon: z.string(),
  weaponMatch: z.enum(["contains"]),
  monster: z.string(),
  monsterMatch: z.enum(["exact", "contains"]),
  /**
   * Added to the damage. Any safe whole number, and one lower: migration 70 turns an old
   * `random(0)` (which drew once and gave 0) into `random(1)` with `delta` one lower.
   */
  delta: z
    .number()
    .refine((n) => Number.isInteger(n) && n >= -(2 ** 53) && n <= Number.MAX_SAFE_INTEGER, {
      message: "a whole number from -2^53 to 2^53 - 1",
    }),
  /**
   * `random(randomN)` added after `delta` (Classic: the Sword of Hope rows' 6); 0 rolls nothing.
   * Any whole number from 0, however large: the `"random(n)"` text it replaced (migration 70) took
   * any digits, and the old reader drew `random(Number(digits))`, so a large n is kept as that very
   * number.
   */
  randomN: z
    .number()
    .min(0)
    .refine((n) => Number.isInteger(n), { message: "a whole number" }),
});

export const monsterSpellKindSchema = z.enum([
  "aimFirst",
  "aimNoExit",
  "dirAfterExits",
  "dirBeforeExits",
  "onPlayer",
  "buff",
]);

export const monsterSpellSchema = z.strictObject({
  tag: z.string().min(1),
  name: z.string().min(1),
  kind: monsterSpellKindSchema,
  power: int.min(0).max(1_000_000),
  ladder: z.array(int).length(7),
  aName: z.boolean(),
});

const on = z.literal(true).optional();

/**
 * A monster definition (issue #31), keyed by its name: what the monster tables decide for it, in
 * one record, which the store compiles into exact rows that win in every table they cover (as an
 * item definition does, #30). An absent field means none: an empty definition takes the pack's
 * rules away from the monster.
 */
export const monsterDefinitionSchema = z.strictObject({
  /** The monster's (or NPC's) name, as the tables test it. */
  name: z.string().min(1).max(80),
  /** Spawns and moves only on sea tiles (`rules.sea`). */
  sea: on,
  /** 3×2 wide (`rules.footprint`). */
  footprint: on,
  /** Walks toward players though off the World Editor's monster list (`rules.hostile`). */
  hostile: on,
  /** Attacks wanted players (`rules.officer`). */
  officer: on,
  /** Never attacks an innocent player (`rules.sparesInnocent`). */
  sparesInnocent: on,
  /** Clears its block when it moves (`rules.clearsBlock`). */
  clearsBlock: on,
  /** A click on it says its own name (`rules.namesSelf`). */
  namesSelf: on,
  /** Never gives quests (`rules.noQuests`). */
  noQuests: on,
  /** Never casts monster spells (`casting.neverCasts`). */
  neverCasts: on,
  /** Broadcast on a kill, `{}` the killer's name (`rules.killBroadcasts`). */
  killBroadcast: z.string().min(1).max(200).optional(),
  /** Melee damage added by a weapon family, in order (`meleeAffinities`, monster side exact). */
  affinities: z
    .array(
      z.strictObject({
        /** A weapon family: part of the weapons' names (never empty, which every weapon contains). */
        weapon: z.string().trim().min(1).max(80),
        delta: meleeAffinitySchema.shape.delta,
        randomN: meleeAffinitySchema.shape.randomN,
      }),
    )
    .max(64)
    .optional(),
  /** The kill skill cap, by species (ahead of the by-body rows); absent: `skillCaps.default`. */
  skillCap: int.min(0).max(1_000_000).optional(),
  /** On the editor lists (`editorLists`): off a list it is taken off it. */
  lists: z
    .strictObject({
      worldEditorMonsters: on,
      worldEditorNpcs: on,
      npcEditorMonsters: on,
      npcEditorNpcs: on,
    })
    .optional(),
});

export const monstersDataSchema = z.strictObject({
  monsters: z.array(monsterSchema),
  editorLists: z.strictObject({
    worldEditor: z.strictObject({
      monsters: z.array(z.string().min(1)),
      npcs: z.array(z.string().min(1)),
    }),
    npcEditor: z.strictObject({
      monsters: z.array(z.string().min(1)),
      npcs: z.array(z.string().min(1)),
    }),
  }),
  rules: z.strictObject({
    /** Sea creatures: they spawn and move only on `sea` tiles. */
    sea: z.array(patternEntry),
    footprint: z.array(patternEntry),
    /** Species off `editorLists.worldEditor.monsters` that still walk toward players. */
    hostile: z.array(patternEntry),
    officer: z.array(patternEntry),
    sparesInnocent: z.array(patternEntry),
    clearsBlock: z.array(patternEntry),
    killBroadcasts: z.array(z.strictObject({ ...patternRow, text: z.string().min(1) })),
    namesSelf: z.array(patternEntry),
    noQuests: z.array(patternEntry),
  }),
  casting: z.strictObject({
    spells: z.array(monsterSpellSchema),
    neverCasts: z.array(patternEntry),
  }),
  meleeAffinities: z.array(meleeAffinitySchema),
  skillCaps: z.strictObject({
    default: int,
    byBody: z.array(z.strictObject({ body: z.string(), skillCap: int })),
    intelligenceTiers: z.array(z.strictObject({ intelligenceGt: int, add: int })),
  }),
  /**
   * Member "Generic" of castLib Monsters: a live name the `mlists` field does not contain is
   * drawn with this body and defense by the original's monster renderer, as a
   * player shop's shopkeeper is.
   */
  generic: z.strictObject({ body: bodyNumberSchema, hp: int, defense: int }),
  /**
   * Monster definitions (issue #31), keyed by name: one record of what the monster tables decide
   * for a monster, compiled into exact rows that win. Classic ships none.
   */
  definitions: z.array(monsterDefinitionSchema).optional(),
});

export type Monster = z.infer<typeof monsterSchema>;
export type MonsterFlags = z.infer<typeof monsterFlagsSchema>;
export type MeleeAffinity = z.infer<typeof meleeAffinitySchema>;
export type MonsterSpellKind = z.infer<typeof monsterSpellKindSchema>;
export type MonsterSpellRule = z.infer<typeof monsterSpellSchema>;
export type MonstersData = z.infer<typeof monstersDataSchema>;
export type MonsterDefinition = z.infer<typeof monsterDefinitionSchema>;
