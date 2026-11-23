/**
 * Schema for `packages/data/content/attpower.json`: the weapon attack-power rows,
 * in source order. `shared/rules/combat/attpower.ts` runs them.
 *
 */
import { z } from "zod";

const int = z.number().int();

const baseRowSchema = z.strictObject({
  match: z.enum(["contains", "exact"]),
  pattern: z.string(),
  expr: z.string(),
  flat: int,
  randomN: int.nullable(),
  /** Gold Axe only: `random(strength) / 2`. */
  extra: z.string().optional(),
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
   * A number, or `random(n)` / `a + random(n)` (shared `evalValue`), each number at most five
   * digits, so no row can overflow or roll a die it cannot.
   */
  value: z.union([
    int.min(-99999).max(99999),
    z.string().regex(/^(?:(?:\d{1,5} \+ )?random\([1-9]\d{0,4}\)|-?\d{1,5})$/),
  ]),
};

const tierSchema = z.strictObject({
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
        tiers: z.array(tierSchema),
      }),
    ),
  }),
});

export type AttPowerData = z.infer<typeof attPowerDataSchema>;
export type AttPowerTier = z.infer<typeof tierSchema>;
