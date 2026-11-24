/**
 * Schema for `packages/data/content/bindings.json`: what the engine needs a world's content to
 * name, so no mechanic depends on a 1.6 name in code (issue #37). A binding left out turns its
 * mechanic off (a world with no Parry skill has no parrying), except the currency, which the
 * content contract requires (checked at publish).
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
  fishing: skillKey,
  blacksmithing: skillKey,
  cooking: skillKey,
  alchemy: skillKey,
  carpentry: skillKey,
});

/** An item key from `items.json`. */
const itemKey = z.string().min(1);

/** A `Chars` body number (the art's member names start with it, `80-…`). */
const body = z.number().int().min(1).max(9999);

/**
 * The currency: the item whose amount a character carries in their purse. A pile of it on the
 * ground is named with its amount, `15 Gold`. Required by the content contract.
 */
export const currencyBindingSchema = z.strictObject({
  item: itemKey.optional(),
});

/** What a new character starts with besides its class's skills. */
export const startBindingSchema = z.strictObject({
  /** Hit points, full. */
  hp: z.number().int().min(1).max(1_000_000),
  /** Spell points, full. */
  sp: z.number().int().min(0).max(1_000_000),
  /** The bag's first lines, in order (the bag holds 15). */
  bag: z
    .array(z.strictObject({ item: itemKey, qty: z.number().int().min(1).max(1_000_000) }))
    .max(15),
});

/** The Battleship's cannon: the item each shot spends. Left out, the cannon cannot fire. */
export const cannonBindingSchema = z.strictObject({
  ammo: itemKey.optional(),
});

/**
 * The bodies the engine puts on a player:
 * - `morph`: Morph's table, ordered by `above`; the last row the spell's roll is above picks the
 *   body. Left out (or empty), Morph does nothing.
 * - `tree`: Nature Shift's tree. Left out, Nature Shift does nothing.
 * - `smoke`: Smoke Bomb's body, which clients draw as nothing. Left out, Smoke Bomb does nothing.
 * - `riders`: what a rider of each vehicle shows. Vehicles are engine kinds, so each needs one; left
 *   out, the world has no vehicles (a deed that makes one is refused).
 */
export const bodyBindingsSchema = z.strictObject({
  morph: z
    .array(z.strictObject({ above: z.number().int().min(0).max(1000), body }))
    .max(64)
    .optional(),
  tree: body.optional(),
  smoke: body.optional(),
  riders: z.strictObject({ Boat: body, Battleship: body, Airship: body }).optional(),
});

export const bindingsDataSchema = z.strictObject({
  currency: currencyBindingSchema,
  start: startBindingSchema,
  cannon: cannonBindingSchema,
  bodies: bodyBindingsSchema,
  skills: skillBindingsSchema,
});

export type SkillBinding = keyof z.infer<typeof skillBindingsSchema>;
export type BindingsData = z.infer<typeof bindingsDataSchema>;
