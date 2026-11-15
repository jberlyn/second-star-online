# Housing

## What happens in play

Using a deed enters placement mode; the player chooses a location and the server checks whether the house can be built there.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/housing/doors.ts](../../packages/server/src/systems/housing/doors.ts): handles keys, switches and relocking.
- [packages/server/src/systems/housing/houses.ts](../../packages/server/src/systems/housing/houses.ts): handles placement, house clocks and demolition.
- [packages/shared/src/rules/housing/doors.ts](../../packages/shared/src/rules/housing/doors.ts): defines key, door and switch rules.
- [packages/shared/src/rules/housing/houses.ts](../../packages/shared/src/rules/housing/houses.ts): defines placement, house plans and decay.

Entry points:

- `packages/shared/src/rules/housing/houses.ts` (`checkPlacement`, `planHouse`, `sweep`).
- `packages/server/src/systems/housing/houses.ts` (`placeHouseIntent`).
- `packages/server/src/systems/housing/doors.ts` (`useKey`).

## How it works

The deed determines the house type and placement preview. Placement checks terrain and obstacles, then the house plan creates an interior and its map name. Owner and guild checks control relevant house actions; house refresh and decay run over time, and resting restores resources. Guild halls have placement and guild requirements. The original land system was inactive and is omitted.

Keys and switches affect matching doors, with relocking handled on ticks. House containers and vaults hand off to economy, while mailboxes and boards use their own systems. The server validates changes instead of accepting arbitrary map edits. House records are stored through [house persistence](../../packages/server/src/persistence/houses.ts).

### Placement and records

Using an eligible deed starts placement; Boat, Battleship and Stone Guild Hall deeds do nothing. The placement checks run in order: map edges, terrain, overlap, available exit slots and guild requirements. A refusal leaves placement active. On success the server creates the outdoor exit and items, creates the interior, consumes the deed, changes eligible tiles and records the blueprint and house list before refreshing the map. If interior creation fails, the preliminary map changes are rolled back. House types and their sizes come from [house content](../../packages/data/content/houses.json).

The shared map helpers generate the interior name from the outdoor coordinates and selected exit slot. Ownership and guild information are used for the room's drop and access rules; vaults use the economy system, while mailboxes and boards use mail and board persistence. House activity refreshes the owner's entries. Periodic clock checks can trigger a decay sweep; demolition removes the associated interior and vault in SSO and updates the map. Rest regeneration is separately rolled while inside.

### Doors and switches

A key acts on the faced door. House and guild keys remain in the bag and have no key pause; coloured keys are consumed and impose a pause. A switch must be faced while standing still, although even a refused click arms its relock timer. Switching changes matching switches and doors across the map. The map's timer closes coloured and switch doors; player and guild doors do not relock themselves.

## Kept bugs and differences

The Small Farm is built one row lower than other houses. Coloured keys are consumed both on opening and closing, and changing a coloured door can change every door of the same name.

See the [housing kept bugs](../bug-ledger.md#housing) and [housing differences](../divergences.md#housing) for the specific player-visible cases.

