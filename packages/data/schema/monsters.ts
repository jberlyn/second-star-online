/** Schema for monster records, editor lists, name-matched rules, casting, affinities and skill caps. */
import { z } from "zod";

import { patternRow } from "./common.ts";

const int = z.number().int();
const patternEntry = z.strictObject(patternRow);

export const monsterSchema = z.strictObject({
  name: z.string().min(1),
  /** Cast line 1: the `Chars` body number; the sprite member is `<body>-F2-<dir>`. */
  body: int,
  /** False for the bodies with no `Chars` bitmap (hidden from the editor). */
  bodyInMainChars: z.boolean(),
  /** Species hit points; every species has them. */
  hp: int,
  /** Death-check HP cap after spell effects (default 200). */
  healCap: int,
  /** Monster attack table value, or null when the name has no entry (it never melees). */
  attack: int.nullable(),
  /** Cast line 3: subtracted from melee AttPower. */
  defense: int,
  /** Base XP, melee kill table and spell kill table. */
  xpMelee: int,
  xpSpell: int,
  /** Zombie and Skeleton: spawn only while `gt < server minute < lt`. */
  spawnMinute: z.strictObject({ gt: int, lt: int }).nullable(),
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
  generic: z.strictObject({ body: int, hp: int, defense: int }),
});

export type Monster = z.infer<typeof monsterSchema>;
export type MeleeAffinity = z.infer<typeof meleeAffinitySchema>;
export type MonsterSpellKind = z.infer<typeof monsterSpellKindSchema>;
export type MonsterSpellRule = z.infer<typeof monsterSpellSchema>;
export type MonstersData = z.infer<typeof monstersDataSchema>;
