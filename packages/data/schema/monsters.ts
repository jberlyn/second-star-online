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
  name: z.string().min(1),
  /** The name players see, when an operator has renamed the species; the key otherwise. */
  display: z.string().min(1).max(40).optional(),
  /**
   * Cast line 1: the `Chars` body number (1 to 9999, `BODY_MAX`); the sprite member is
   * `<body>-F2-<dir>`. Uploaded bodies are numbered from 1000 (`OPERATOR_BODY_MIN`).
   */
  body: bodyNumberSchema,
  /** False for the bodies with no `Chars` bitmap (hidden from the editor). */
  bodyInMainChars: z.boolean(),
  /** Species hit points; every species has them. */
  hp: int,
  /** Monster attack table value, or null when the name has no entry (it never melees). */
  attack: int.nullable(),
  /** Cast line 3: subtracted from melee AttPower. */
  defense: int,
  /** Base XP, melee kill table and spell kill table. */
  xpMelee: int,
  xpSpell: int,
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
  delta: int,
  /** `random(n)` added after `delta` (Sword of Hope rows), or null. */
  deltaRandom: z
    .string()
    .regex(/^random\(\d+\)$/)
    .nullable(),
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
  power: int,
  ladder: z.array(int).length(7),
  aName: z.boolean(),
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
    killXp: z.array(z.strictObject({ ...patternRow, xp: int })),
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
});

export type Monster = z.infer<typeof monsterSchema>;
export type MonsterFlags = z.infer<typeof monsterFlagsSchema>;
export type MeleeAffinity = z.infer<typeof meleeAffinitySchema>;
export type MonsterSpellKind = z.infer<typeof monsterSpellKindSchema>;
export type MonsterSpellRule = z.infer<typeof monsterSpellSchema>;
export type MonstersData = z.infer<typeof monstersDataSchema>;
