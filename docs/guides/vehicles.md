# Vehicles

## What happens in play

Use an Airship Deed while standing still and facing an empty landing pad to build an Airship. Face it and click it or press Ctrl to board; when you reach an empty landing pad, use Ctrl to park and get off.

## Where it lives

- [packages/shared/src/rules/vehicles/vehicles.ts](../../packages/shared/src/rules/vehicles/vehicles.ts): checks deed placement, boarding, ownership and landing pads.
- [packages/server/src/systems/vehicles/airship.ts](../../packages/server/src/systems/vehicles/airship.ts): applies those checks, changes ground items and rider state, and handles death aboard.

Entry points include `packages/server/src/systems/vehicles/airship.ts` (`airshipDeed`), `packages/server/src/systems/vehicles/airship.ts` (`airshipClick`), `packages/server/src/systems/vehicles/airship.ts` (`unboardAirship`) and `packages/server/src/systems/vehicles/airship.ts` (`vehicleDeath`).

## How it works

Building checks whether the player is moving, whether the faced position is on the map and is a J2 landing pad, and whether an item occupies it. Success consumes a deed and creates an owned ground item. A stationary owner facing the Airship can board it; another player cannot. An item without a stored owner falls back to the name on the item. Boarding removes the ground item and changes the rider's body and position for the room.

An Airship uses its own walk grid while ridden, flies over players, monsters, items and exits, and takes a shorter step than a walker. Riders cannot cast or swing; monster melee does not hit them, although projectiles and damage spells can. To unboard, the rider must be stationary on a J2 pad without a ground item. Parking restores the ground item and the player's normal body. The server marks the relevant ground, inventory and vehicle state for persistence together. A normal death aboard loses the airship and drops nothing but a faction head, [kept on purpose](../differences-from-fso.md#dying-aboard-an-airship-loses-it) as the risk of flying into danger. An arena defeat keeps the rider aboard, and a rider cannot challenge. Boats are not implemented. Ctrl aboard always tries to unboard; ordinary item drops are refused, but a Pig can be dropped, and gold and crystals can still be dropped.

## Differences from 1.6

Landing pad checks read layer 1 across all 12 rows, fixing the original's row 10–12 lookup. Airships are converted by the server and the original ground item cap is removed. See the [vehicle bugs fixed](../differences-from-fso.md#vehicles), the challenge fix among the [progression bugs fixed](../differences-from-fso.md#progression), [server-side vehicle changes](../differences-from-fso.md#server-side-vehicles) and [movement bugs fixed](../differences-from-fso.md#movement).
