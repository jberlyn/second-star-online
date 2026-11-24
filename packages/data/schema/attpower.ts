/**
 * Schema for `packages/data/content/attpower.json`: the weapon attack-power rows,
 * in source order. `shared/rules/combat/attpower.ts` runs them.
 *
 */
import { z } from "zod";

const int = z.number().int();

/**
 * A base roll: `flat + random(randomN)` (no draw when `randomN` is 0), plus `random(strength) / 2`
 * when `strengthHalf` is set (Classic's Gold Axe). Structured parts, as the balance amounts are
 * (#19): there is no formula text to read. `flat` is any whole number and `randomN` any from 0, as
 * the rows before this shape allowed, so every world written then still loads (migration 68).
 */
const baseRowSchema = z.strictObject({
  match: z.enum(["contains", "exact"]),
  pattern: z.string(),
  flat: int,
  randomN: int.min(0),
  strengthHalf: z.boolean().optional(),
});

/** A rolled tier value: `flat + random(randomN)`, drawing nothing when `randomN` is 0. */
export const rolledValueSchema = z.strictObject({
  flat: int.min(-99999).max(99999),
  randomN: int.min(0).max(99999),
});

/**
 * A tier row's condition, operation and value: shared by attack power's tiers and spell power's
 * tables (spells.json).
 */
export const tierFields = {
  /**
   * `["<Skill> <op> <n>"]` with op `<` or `>` (`level` for the character level), or null for an
   * unconditional row. Exactly what combat reads (shared `tierApplies`), so nothing else publishes.
   */
  when: z.array(z.string().regex(/^\w+ [<>] \d+$/)).nullable(),
  op: z.enum(["set", "add", "subtract"]),
  /**
   * A number, or a roll `{ flat, randomN }` (shared `evalValue`), each number at most five digits,
   * so no row can overflow or roll a die it cannot.
   */
  value: z.union([int.min(-99999).max(99999), rolledValueSchema]),
};

export const attPowerTierSchema = z.strictObject({
  subWeapon: z.strictObject({ match: z.enum(["exact"]), pattern: z.string() }).nullable(),
  ...tierFields,
});

export const attPowerDataSchema = z.strictObject({
  attPower: z.strictObject({
    handler: z.string(),
    base: z.array(baseRowSchema),
    exactOverrides: z.array(baseRowSchema),
    arrowBonus: z.array(
      z.strictObject({ arrows: z.string(), match: z.enum(["exact"]), bonus: int }),
    ),
    ringBonus: z.array(
      z.strictObject({
        ring: z.string(),
        match: z.enum(["exact"]),
        bonus: int,
        requiresBow: z.boolean(),
      }),
    ),
    skillBlocks: z.array(
      z.strictObject({
        weaponMatch: z.enum(["contains", "exact", "any"]),
        pattern: z.string().nullable(),
        tiers: z.array(attPowerTierSchema),
      }),
    ),
  }),
});

export type AttPowerData = z.infer<typeof attPowerDataSchema>;
export type AttPowerTier = z.infer<typeof attPowerTierSchema>;
export type AttPowerBase = z.infer<typeof baseRowSchema>;
export type RolledValue = z.infer<typeof rolledValueSchema>;
