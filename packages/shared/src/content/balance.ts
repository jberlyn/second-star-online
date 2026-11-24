/**
 * The balance numbers (issue #19): the engine's default for every value, and the store's full
 * balance, a world's `balance` dataset with every part it leaves out filled from the defaults.
 *
 * The defaults are the numbers the engine played before they became content: 1.6's where 1.6 had
 * them, SSO's own for its additions (vehicle hulls and the cannon, issue #2). The Classic pack
 * writes the same values out; a pack that leaves a part out (Minimal leaves them all) plays these.
 */
import type { BalanceData, BalanceVehicle, FlatAmount, HullRow } from "@secondstaronline/data";

import { TICK_HZ } from "../constants.ts";
import type { Rng } from "../rules/core/lingo.ts";

/** A world's balance with every part present. */
export interface Balance {
  vehicles: NonNullable<BalanceData["vehicles"]>;
  cannon: NonNullable<BalanceData["cannon"]>;
  /** One row for each vehicle, in `BALANCE_VEHICLE_ORDER`. */
  hulls: HullRow[];
}

/** The engine's vehicle kinds, in the order the Balance page lists them. */
export const BALANCE_VEHICLE_ORDER: readonly BalanceVehicle[] = ["Boat", "Airship", "Battleship"];

/** The engine's defaults: what a world plays for every value its packs and operator leave out. */
export const BALANCE_DEFAULTS: Readonly<Balance> = {
  vehicles: { hullHit: 2, repairPerMinute: 1 },
  cannon: { damage: { flat: 13, randomN: 3 }, reloadFrames: 5 * TICK_HZ },
  hulls: [
    { vehicle: "Boat", hull: 60 },
    { vehicle: "Airship", hull: 80 },
    { vehicle: "Battleship", hull: 150 },
  ],
};

/**
 * A world's full balance: each part it sets, else the default; hull rows for every vehicle (a
 * vehicle the rows leave out keeps its default). Pure; nothing is shared with `data`.
 */
export function fullBalance(data: BalanceData | undefined): Balance {
  const d = data ?? {};
  const hulls = BALANCE_VEHICLE_ORDER.map((vehicle) => {
    const row =
      d.hulls?.find((h) => h.vehicle === vehicle) ??
      BALANCE_DEFAULTS.hulls.find((h) => h.vehicle === vehicle);
    return { vehicle, hull: row?.hull ?? 1 };
  });
  return {
    vehicles: structuredClone(d.vehicles ?? BALANCE_DEFAULTS.vehicles),
    cannon: structuredClone(d.cannon ?? BALANCE_DEFAULTS.cannon),
    hulls,
  };
}

/** Rolls an amount: `flat + random(randomN)`, drawing nothing when `randomN` is 0. */
export function rollFlat(a: FlatAmount, rng: Rng): number {
  return a.flat + (a.randomN > 0 ? rng.random(a.randomN) : 0);
}
