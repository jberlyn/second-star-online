# Vehicles

## What happens in play

Use an Airship Deed while standing still and facing an empty landing pad to build an Airship. Face it and click it or press Ctrl to board; when you reach an empty landing pad, use Ctrl to park and get off.

## Where it lives

- [packages/shared/src/rules/vehicles/vehicles.ts](../../packages/shared/src/rules/vehicles/vehicles.ts): checks deed placement, boarding, ownership and landing pads.
- [packages/server/src/systems/vehicles/airship.ts](../../packages/server/src/systems/vehicles/airship.ts): applies those checks, changes ground items and rider state, and handles death aboard.

Hull numbers and rules (`HULL_MAX`, `HULL_HIT_DAMAGE`, `HULL_REPAIR_PER_MINUTE`, `boardingHull`, `sunkText`) live in the shared vehicles module; hits reach the hull in `packages/server/src/systems/spells/collide.ts` (`playerCollision`).

Entry points include `packages/server/src/systems/vehicles/airship.ts` (`airshipDeed`), `packages/server/src/systems/vehicles/airship.ts` (`airshipClick`), `packages/server/src/systems/vehicles/airship.ts` (`unboardAirship`) and `packages/server/src/systems/vehicles/airship.ts` (`vehicleDeath`).

## How it works

Building checks whether the player is moving, whether the faced position is on the map and is a J2 landing pad, and whether an item occupies it. Success consumes a deed and creates an owned ground item. A stationary owner facing the Airship can board it; another player cannot. An item without a stored owner falls back to the name on the item. Boarding removes the ground item and changes the rider's body and position for the room.

An Airship uses its own walk grid while ridden, flies over players, monsters, items, exits and webs, and each step takes half a walker's time (`STEP_FRAMES / 2`). Riders cannot cast or swing, and neither monster nor player melee hits them. Arrows and harmful spells do, but they wear the vehicle's hull instead of the rider's HP: a fixed 2 per hit, whatever the attacker's power. The rider's HP bar shows the hull while aboard. A new airship starts with a full hull of 80; a parked one keeps its hull and regains 1 for each minute parked, worked out when it is boarded. To unboard, the rider must be stationary on a J2 pad without a ground item. Parking restores the ground item and the player's normal body. The server marks the relevant ground, inventory and vehicle state for persistence together. A death aboard, including the hull running out, loses the airship and drops nothing but a faction head, [kept on purpose](../differences-from-fso.md#dying-aboard-an-airship-loses-it) as the risk of flying into danger. A hull running out counts as a kill for whoever hit it last, and everyone reads that the airship was shot down instead of the death line. Vehicles stay out of arenas: a rider cannot challenge, and over arena tiles it is judged by the map's PvP flag alone, dies a normal death and cannot quit. Ctrl aboard first grabs a Pig or Snow Demon in front, otherwise takes or uses the item there as on foot, and unboards when there is neither. Nothing can be dropped from an airship (items, gold, crystals or a Pig: "You can't drop this from the sky!"), but items, gold and crystals can still be given to the player in front, and gold to an NPC. Boats are not implemented yet ([issue #2](https://github.com/jberlyn/second-star-online/issues/2)).

## Differences from 1.6

Landing pad checks read layer 1 across all 12 rows, fixing the original's row 10–12 lookup. Airships are converted by the server and the original ground item cap is removed. See the [vehicle bugs fixed](../differences-from-fso.md#vehicles), the challenge fix among the [progression bugs fixed](../differences-from-fso.md#progression), [server-side vehicle changes](../differences-from-fso.md#server-side-vehicles) and [movement bugs fixed](../differences-from-fso.md#movement).
