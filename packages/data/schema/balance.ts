/**
 * Schema for the `balance` dataset (issue #19): the game's global balance numbers, edited on the
 * Control Panel's Balance page. Every value has an engine default (shared `BALANCE_DEFAULTS`,
 * 1.6's own numbers), so a pack may leave the dataset or any part of it out and the engine plays
 * the defaults. The Classic pack writes 1.6's values out.
 *
 * Small groups are one row each (`vehicles`, `cannon`); lists of like things are keyed rows
 * (`hulls`, by vehicle), so a pack update that changes one value notices only its row.
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
export type HullRow = z.infer<typeof hullRowSchema>;
export type BalanceVehicle = (typeof BALANCE_VEHICLES)[number];
export type VehicleBalance = z.infer<typeof vehicleBalanceSchema>;
export type CannonBalance = z.infer<typeof cannonBalanceSchema>;
export type BalanceData = z.infer<typeof balanceDataSchema>;
