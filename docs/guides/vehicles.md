# Vehicles

## What happens in play

There are three vehicles: the Airship, the Boat and the Battleship.

- **Airship:** use an Airship Deed while standing still and facing an empty landing pad to build it. Face it and click it or press Ctrl to board; when you reach an empty landing pad, use Ctrl to park and get off.
- **Boat and Battleship:** use the deed while standing still on the shore and facing open water to build the ship there. Face it from the shore and click it or press Ctrl to board. It sails only on water, at walking pace. To get off, stop beside the shore, face a free tile of land and press Ctrl: you step ashore and the ship stays parked on the water.

Only the owner can board. Hits on a rider wear the vehicle's hull instead of the rider's HP, and the HP bar shows the hull while aboard.

## Where it lives

- [packages/shared/src/rules/vehicles/vehicles.ts](../../packages/shared/src/rules/vehicles/vehicles.ts): checks deed placement, boarding, ownership, landing pads and getting ashore, and holds the hull numbers and lines.
- [packages/shared/src/rules/core/walk.ts](../../packages/shared/src/rules/core/walk.ts): the Airship's and the ships' walk grids (`airshipWalkGrid`, `shipWalkGrid`).
- [packages/server/src/systems/vehicles/vehicles.ts](../../packages/server/src/systems/vehicles/vehicles.ts): applies those checks, changes ground items and rider state, and handles death aboard.

Hull numbers and rules (`HULL_MAX`, `HULL_HIT_DAMAGE`, `HULL_REPAIR_PER_MINUTE`, `boardingHull`, `sunkText`) live in the shared vehicles module; hits reach the hull in `packages/server/src/systems/spells/collide.ts` (`playerCollision`). Movement on each grid is chosen in `packages/server/src/systems/movement/movement.ts` (`walkWorld`) and, for map edges, `walkGridFor`.

Entry points include `packages/server/src/systems/vehicles/vehicles.ts` (`vehicleDeed`, `vehicleClick`, `unboardVehicle` and `vehicleDeath`).

## How it works

Building checks whether the player is moving, whether the faced tile is on the map, and whether it suits the vehicle: a J2 landing pad for an Airship, or a tile on the ships' grid for a Boat or Battleship. It must hold no item (and, for a ship, no player). Success consumes a deed and creates an owned ground item, `<name>'s Airship`, `'s Boat` or `'s Battleship`. A stationary owner facing it can board it; another player cannot. An item without a stored owner falls back to the name on the item. Boarding removes the ground item, sets the rider's body (57 Airship, 55 Boat, 56 Battleship) and moves the rider onto its tile.

An Airship uses its own walk grid while ridden, flies over players, monsters, items, exits and webs, and each step takes half a walker's time (`STEP_FRAMES / 2`). A ship moves on water only: layer-1 tiles flagged `sea`, whatever shoreline art layer 2 draws over them. It steps at walking pace and is blocked like a walker by players (other than airship riders), monsters and blocking items, parked ships included. Crossing a map edge needs the wrapped tile to be on the rider's own grid on the next map, so a ship crosses only onto water.

Riders cannot cast or swing, and neither monster nor player melee hits them. Arrows and harmful spells do, but they wear the vehicle's hull instead of the rider's HP: a fixed 2 per hit, whatever the attacker's power. The rider's HP bar shows the hull while aboard. A new vehicle starts with a full hull (Boat 60, Airship 80, Battleship 150); a parked one keeps its hull and regains 1 for each minute parked, worked out when it is boarded.

To get off an Airship, the rider must be stationary on a J2 pad without a ground item; the airship parks under them. To get off a ship, the rider must be stationary and face a tile a walker could step onto: walkable on foot, not an exit, and free of players, monsters and blocking items. The ship parks on the rider's water tile, which must hold no item, and the rider steps ashore. Parking restores the player's normal body. The server marks the relevant ground, inventory and vehicle state for persistence together.

A death aboard, including the hull running out, loses the vehicle and drops nothing but a faction head, [kept on purpose](../differences-from-fso.md#dying-aboard-an-airship-loses-it) as the risk of travelling into danger. A hull running out counts as a kill for whoever hit it last, and everyone reads that the airship was shot down, or the ship sunk, instead of the death line. Vehicles stay out of arenas: a rider cannot challenge, and over arena tiles it is judged by the map's PvP flag alone, dies a normal death and cannot quit. Ctrl aboard first grabs a Pig or Snow Demon in front, otherwise takes or uses the item there as on foot, and unboards when there is neither. Nothing can be dropped from a vehicle (items, gold, crystals or a Pig): "You can't drop this from the sky!" on an Airship, "You can't drop this into the ocean!" on a ship. Items, gold and crystals can still be given to the player in front, and gold to an NPC. The Battleship's cannon is not built yet ([issue #2](https://github.com/jberlyn/second-star-online/issues/2)).

## Differences from 1.6

Landing pad checks read layer 1 across all 12 rows, fixing the original's row 10–12 lookup. Boats and Battleships, written but switched off in 1.6, are built, with a water-only walk grid 1.6 never had. Vehicles are converted by the server and the original ground item cap is removed. Hulls and keeping vehicles out of arenas are SSO additions. See the [vehicle bugs fixed](../differences-from-fso.md#vehicles), the challenge fix among the [progression bugs fixed](../differences-from-fso.md#progression), [server-side vehicle changes](../differences-from-fso.md#server-side-vehicles) and [movement bugs fixed](../differences-from-fso.md#movement).
