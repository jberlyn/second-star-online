/**
 * Schema for `packages/data/content/bindings.json`: what the engine needs a world's content to
 * name, so no mechanic depends on a 1.6 name in code (issue #37). Every binding is optional: one a
 * world leaves out turns its mechanic off (a world with no Parry skill has no parrying).
 */
import { z } from "zod";

/** A skill key from `classes.json` `skills`. */
const skillKey = z.string().min(1).optional();

/**
 * The skills the engine reads, by what it reads them for:
 * - `parry`, `block`: the dodge rolls against melee and monster hits;
 * - `archery`, `martialArts`: trained by a bow kill and an empty-handed kill;
 * - `staffFighting`: the staff's bonus to spell damage;
 * - `magery`: every cast's power and its gain roll;
 * - `axeFighting`, `mining`: the swing speed ladders of axes and mining tools;
 * - `fishing`: the catch bands and the fishing gain;
 * - `blacksmithing`, `cooking`, `alchemy`, `carpentry`: the four crafts.
 */
export const skillBindingsSchema = z.strictObject({
  parry: skillKey,
  block: skillKey,
  archery: skillKey,
  martialArts: skillKey,
  staffFighting: skillKey,
  magery: skillKey,
  axeFighting: skillKey,
  mining: skillKey,
  fishing: skillKey,
  blacksmithing: skillKey,
  cooking: skillKey,
  alchemy: skillKey,
  carpentry: skillKey,
});

export const bindingsDataSchema = z.strictObject({
  skills: skillBindingsSchema,
});

export type SkillBinding = keyof z.infer<typeof skillBindingsSchema>;
export type BindingsData = z.infer<typeof bindingsDataSchema>;
