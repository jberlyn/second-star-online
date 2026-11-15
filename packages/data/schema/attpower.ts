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

const tierSchema = z.strictObject({
  subWeapon: z.strictObject({ match: z.enum(["exact"]), pattern: z.string() }).nullable(),
  /** `["<Skill> <op> <n>"]`, or null for an unconditional row. */
  when: z.array(z.string()).nullable(),
  op: z.enum(["set", "add", "subtract"]),
  /** A number, or `random(n)` / `a + random(n)`. */
  value: z.union([int, z.string()]),
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
